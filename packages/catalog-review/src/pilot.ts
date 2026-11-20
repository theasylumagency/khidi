import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { catalogFeedbackEntries as entries, catalogLegacyProducts as products, catalogReviewPhotoLinks as links,
  catalogReviewPhotos as photos, catalogFeedbackCards as cards, users, type AppDatabase, type DbExecutor } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError, createUuidV7 } from "@khidi/shared";
import { assigned, lockPilotPhotoWork, pilotBatch, reviewerAssignment } from "./access.ts";
import { assessments, fieldKeys, fieldProblem, originals, relationKinds, storeLayout, type CardDefinition, type Originals } from "./fields.ts";

const note=z.string().trim().max(1600);
export const feedbackAnswer=z.object({state:z.enum(["","KNOWN","UNKNOWN"]),text:note,source:note}).strict();
export const feedbackResponse=z.object({ fields:assessments, answers:z.array(feedbackAnswer).max(8),
  suggestion:note.optional(), photoNote:note.optional(), layout:storeLayout.optional(),
  activeSeconds:z.number().int().nonnegative().max(7*24*3600).optional() }).strict();
export type FeedbackResponse=z.infer<typeof feedbackResponse>;
export const feedbackInput=z.object({productId:z.string().uuid(), revision:z.number().int().nonnegative(),
  submit:z.boolean(), response:feedbackResponse}).strict();

export async function listPilot(db: DbExecutor, principal: AuthenticatedPrincipal, selection?: number | string) {
  const round = typeof selection === "string"
    ? sql`(SELECT c.round_no FROM catalog_feedback_round_cards c JOIN catalog_legacy_products p ON p.wordpress_id=c.wordpress_id WHERE p.id=${selection})`
    : selection ?? sql`(SELECT max(round_no) FROM catalog_feedback_round_cards)`;
  const rows=await db.selectDistinctOn([products.id], {id:products.id,batch:products.batchId,round:cards.round,position:cards.position,
    definition:sql<unknown>`COALESCE((SELECT r.definition FROM catalog_feedback_round_card_revisions r
      WHERE r.round_no=${cards.round} AND r.position=${cards.position} ORDER BY r.revision DESC LIMIT 1),${cards.definition})`,
    cardRevision:sql<number>`COALESCE((SELECT max(r.revision) FROM catalog_feedback_round_card_revisions r
      WHERE r.round_no=${cards.round} AND r.position=${cards.position}),1)`,canWrite:sql<boolean>`${reviewerAssignment(db,principal)}`,revision:entries.revision,
    submitted:entries.submitted,response:entries.response,actor:users.fullName,at:entries.createdAt,snapshot:entries.card})
    .from(products).innerJoin(cards,eq(cards.wp,products.wordpressId)).leftJoin(entries,eq(entries.productId,products.id))
    .leftJoin(users,eq(entries.actorId,users.id)).where(and(assigned(db,principal),pilotBatch(db),eq(cards.round,round)))
    .orderBy(asc(products.id),desc(entries.revision));
  const gallery=rows.length ? await db.select({product:links.productId,id:links.photoId,source:photos.sourceUrl,audit:photos.audit}).from(links)
    .innerJoin(photos,eq(photos.id,links.photoId)).where(inArray(links.productId,rows.map(r=>r.id)))
    .orderBy(asc(links.position),asc(links.photoId)) : [];
  return rows.sort((a,b)=>a.position-b.position).map(row=>{
    const template=row.definition as CardDefinition;
    const snap=row.snapshot as (Partial<CardDefinition> & { original?:Originals; previousFeedback?:Record<string,unknown> }) | null;
    const card:CardDefinition=snap?.original ? snap as CardDefinition : snap ? { ...template,
      name:snap.name ?? template.name, description:snap.description ?? template.description,
      facts:snap.facts ?? template.facts, kit:typeof snap.kit==="string" ? [snap.kit] : snap.kit ?? [],
      questions:snap.questions ?? template.questions } : template;
    const assets=gallery.filter(p=>p.product===row.id);
    const original=snap?.original ?? originals(card,assets.filter(p=>!p.source.startsWith("review:")).map(p=>p.id));
    const parsed=feedbackResponse.safeParse(row.response);
    const illustrations=assets.filter(p=>(p.audit as Record<string,unknown>|null)?.origin==="COMPOSITION").map(p=>p.id);
    return { id:row.id,batch:row.batch,round:row.round,position:row.position,cardRevision:Number(row.cardRevision),card,original,
      photoIds:assets.map(p=>p.id),illustrations,
      revision:row.revision ?? 0,submitted:row.submitted ?? false,canWrite:row.canWrite,actor:row.actor,at:row.at,
      response:parsed.success ? parsed.data : null,legacy:snap?.previousFeedback ?? (parsed.success ? null : row.response as Record<string,unknown>|null) };
  });
}
export type PilotRow=Awaited<ReturnType<typeof listPilot>>[number];

export async function savePilot(db: AppDatabase, principal: AuthenticatedPrincipal, key: string, raw: z.infer<typeof feedbackInput>) {
  const parsed=feedbackInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR","Invalid feedback.");
  const input=parsed.data;
  async function requireAssignment(executor:DbExecutor) {
    const [eligible]=await executor.select({id:products.id}).from(products).where(and(eq(products.id,input.productId),
      assigned(executor,principal),pilotBatch(executor),reviewerAssignment(executor,principal)));
    if (!eligible) throw new AppError("NOT_FOUND","Assigned pilot card required.");
  }
  await requireAssignment(db);
  return executeIdempotent(db,{scope:"catalog-feedback:"+principal.userId,idempotencyKey:key,payload:input},
    tx=>withDomainTransaction(tx,{userId:principal.userId},async ctx=>{
      await requireAssignment(ctx.tx);
      await lockPilotPhotoWork(ctx.tx,principal,input.productId);
      const cohort=await listPilot(ctx.tx,principal,input.productId);
      const row=cohort.find(r=>r.id===input.productId);
      if (!row) throw new AppError("NOT_FOUND","Unknown card.");
      if (row.revision!==input.revision) throw new AppError("CONFLICT","Newer feedback exists.");
      const {fields,answers}=input.response;
      if (fieldKeys.some(k=>fieldProblem(k,fields[k],row.original[k],input.submit)) ||
        answers.length!==row.card.questions.length || input.submit && answers.some(a=>!a.state || a.state==="KNOWN" && (!a.text || !a.source)))
        throw new AppError("VALIDATION_ERROR","Incomplete feedback.");
      const refs=fields.links.value.map(v=>v.split(":"));
      if (refs.some(([kind,wp,...rest])=>rest.length || !relationKinds.some(k=>k===kind) ||
        !cohort.some(r=>String(r.card.wp)===wp && r.id!==row.id)) ||
        new Set(refs.map(r=>r[1])).size!==refs.length || fields.photos.value.some(id=>!row.photoIds.includes(id)) ||
        new Set(fields.photos.value).size!==fields.photos.value.length ||
        // An AI composition shows an accessory that may not fit: it can illustrate, never be the main photo.
        fields.photos.value[0]!==undefined && row.illustrations.includes(fields.photos.value[0])) throw new AppError("VALIDATION_ERROR","Invalid selection.");
      const id=createUuidV7(), revision=input.revision+1;
      await ctx.tx.insert(entries).values({ id,revision,productId:row.id,actorId:principal.userId,
        submitted:input.submit,response:input.response,card:{...row.card,original:row.original,...(row.legacy?{previousFeedback:row.legacy}:{})} });
      const event=input.submit ? "CATALOG_FEEDBACK_SUBMITTED" : "CATALOG_FEEDBACK_DRAFTED";
      const payload={productId:row.id,round:row.round,revision};
      await ctx.recordAudit({action:event,entityType:"catalog_feedback_entry",entityId:id,after:payload});
      await ctx.emitOutboxEvent({eventType:event,aggregateType:"catalog_feedback_entry",aggregateId:id,payload,consumers:[]});
      return {status:200,body:{id,revision}};
    }));
}

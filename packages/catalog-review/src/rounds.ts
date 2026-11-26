import { and, asc, eq, exists, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { catalogFeedbackCards as cards, catalogFeedbackSurveys as surveys, catalogFeedbackDecisions as decisions, catalogFeedbackClosures as closures,
  catalogLegacyProducts as products, catalogReviewProposals as proposals, type AppDatabase, type DbExecutor } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError } from "@khidi/shared";
import { cardDefinition } from "./fields.ts";
import { listPilot, type PilotRow } from "./pilot.ts";

const round=z.number().int().positive();
const reason=z.string().trim().min(1).max(1600);
export const roundAction=z.discriminatedUnion("action",[
  z.object({action:z.literal("SURVEY"),round,answers:z.array(reason).length(3)}).strict(),
  z.object({action:z.literal("OPEN"),round,choice:z.enum(["KEEP","CHANGE"]),note:reason,cards:z.array(cardDefinition).length(20)}).strict(),
  z.object({action:z.literal("CLOSE"),round,note:reason}).strict()
]);
/** ADR-017: a round moves on when all twenty cards are submitted or an administrator closed it early. */
export const roundFinished=(rows:PilotRow[],closure:unknown)=>Boolean(closure) || rows.length===20 && rows.every(r=>r.submitted);
export async function roundDetails(db:DbExecutor, rows:PilotRow[]) {
  if (!rows.length) return {survey:null,decision:null,closure:null};
  const first=rows[0]!;
  const [survey]=await db.select().from(surveys).where(and(eq(surveys.round,first.round),eq(surveys.batchId,first.batch)));
  const [decision]=await db.select().from(decisions).where(eq(decisions.round,first.round));
  const [closure]=await db.select().from(closures).where(and(eq(closures.round,first.round),eq(closures.batchId,first.batch)));
  return {survey:survey ?? null, decision:decision ?? null, closure:closure ?? null};
}
function hasProposal(db:DbExecutor) {
  return exists(db.select({id:proposals.id}).from(proposals).where(eq(proposals.productId,products.id)));
}
export async function nextCandidates(db:DbExecutor,principal:AuthenticatedPrincipal,rows:PilotRow[]) {
  if (principal.role!=="ADMIN" || !rows[0]) return [];
  const found=await db.select({wp:products.wordpressId,baseline:products.baseline}).from(products)
    .where(and(eq(products.batchId,rows[0].batch),hasProposal(db),
      sql`NOT EXISTS (SELECT 1 FROM catalog_feedback_round_cards c WHERE c.wordpress_id=${products.wordpressId})`))
    .orderBy(asc(products.wordpressId));
  return found.map(p=>({wp:p.wp,name:String(p.baseline["არსებული სახელი"] ?? "")}));
}
export async function saveRound(db:AppDatabase,principal:AuthenticatedPrincipal,key:string,raw:z.infer<typeof roundAction>) {
  const result=roundAction.safeParse(raw);
  if (!result.success) throw new AppError("VALIDATION_ERROR","Invalid round.");
  const input=result.data;
  if (input.action!=="SURVEY" && principal.role!=="ADMIN") throw new AppError("FORBIDDEN","Admin required.");
  return executeIdempotent(db,{scope:"catalog-feedback-round:"+principal.userId,idempotencyKey:key,payload:input},
    tx=>withDomainTransaction(tx,{userId:principal.userId},async ctx=>{
      await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('catalog-feedback-round',0))`);
      const rows=await listPilot(ctx.tx,principal,input.round), first=rows[0];
      if (!first || input.action==="SURVEY" && !first.canWrite) throw new AppError("FORBIDDEN","Assignment required.");
      const {survey,decision,closure}=await roundDetails(ctx.tx,rows);
      if (decision) throw new AppError("CONFLICT","Round already decided.");
      if (input.action==="CLOSE") {
        const submitted=rows.filter(r=>r.submitted).length, drafts=rows.filter(r=>!r.submitted && r.revision>0).length;
        if (rows.length!==20 || closure || submitted===20) throw new AppError("CONFLICT","Round cannot be closed early.");
        await ctx.tx.insert(closures).values({round:input.round,batchId:first.batch,actor:principal.userId,note:input.note,
          submitted,drafts,untouched:20-submitted-drafts});
      } else if (!roundFinished(rows,closure)) throw new AppError("CONFLICT","Complete or close the round first.");
      else if (input.action==="SURVEY") {
        if (survey) throw new AppError("CONFLICT","Survey already submitted.");
        await ctx.tx.insert(surveys).values({round:input.round,actor:principal.userId,batchId:first.batch,answers:input.answers});
      } else {
        const ids=input.cards.map(c=>c.wp);
        const available=await ctx.tx.select({wp:products.wordpressId}).from(products)
          .where(and(eq(products.batchId,first.batch),inArray(products.wordpressId,ids),hasProposal(ctx.tx)));
        const reused=await ctx.tx.select({wp:cards.wp}).from(cards).where(inArray(cards.wp,ids)).limit(1);
        if (available.length!==20 || reused.length || input.cards.some(c=>
          new Set(c.links.map(l=>l.wp)).size!==c.links.length || c.links.some(l=>l.wp===c.wp || !ids.includes(l.wp))))
          throw new AppError("VALIDATION_ERROR","Choose twenty distinct unused products and valid peers.");
        await ctx.tx.insert(decisions).values({round:input.round,actor:principal.userId,choice:input.choice,note:input.note});
        await ctx.tx.insert(cards).values(input.cards.map((card,i)=>({round:input.round+1,position:i+1,wp:card.wp,definition:card})));
      }
      const event=input.action==="SURVEY" ? "CATALOG_FEEDBACK_SURVEY_SAVED" : input.action==="CLOSE" ? "CATALOG_FEEDBACK_ROUND_CLOSED_EARLY" : "CATALOG_FEEDBACK_ROUND_OPENED";
      const payload={round:input.round,action:input.action};
      await ctx.recordAudit({action:event,entityType:"catalog_feedback_round",entityId:first.batch,after:payload});
      await ctx.emitOutboxEvent({eventType:event,aggregateType:"catalog_feedback_round",aggregateId:first.batch,payload,consumers:[]});
      return {status:200,body:{round:input.action==="OPEN" ? input.round+1 : input.round}};
    }));
}

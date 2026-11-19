import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { catalogFeedbackEntries as entries, catalogLegacyProducts as products, catalogReviewPhotoLinks as photos,
  users, type AppDatabase, type DbExecutor } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError, createUuidV7 } from "@khidi/shared";
import { assigned, lockPilotPhotoWork, pilotBatch, reviewerAssignment } from "./access.ts";
import { pilotByWp, pilotCards, type PilotCard } from "./pilot-cards.ts";

const note = z.string().trim().max(1600);
export const feedbackAnswer = z.object({
  state: z.enum(["", "KNOWN", "UNKNOWN"]), text: note, source: note
}).strict();
export const feedbackResponse = z.object({
  outcome: z.enum(["", "OK", "CORRECT", "UNKNOWN"]), correction: note,
  targets: z.array(z.enum(["name","facts","description","kit","links","photos"])).max(6).default([]),
  answers: z.array(feedbackAnswer).max(8), fieldChange: z.enum(["", "ADD", "REMOVE", "CHANGE"]),
  fieldNote: note, photoId: z.string().uuid().nullable(), photoNote: note
}).strict();
export type FeedbackResponse = z.infer<typeof feedbackResponse>;
export const feedbackInput = z.object({
  productId: z.string().uuid(), revision: z.number().int().nonnegative(),
  submit: z.boolean(), response: feedbackResponse
}).strict();
export function validateFeedback(card: PilotCard, response: FeedbackResponse, submit: boolean) {
  if (response.answers.length !== card.questions.length || (submit && (
    !response.outcome || (response.outcome === "CORRECT" && !response.correction) ||
    (response.fieldChange && !response.fieldNote) || response.answers.some(a =>
      !a.state || (a.state === "KNOWN" && (!a.text || !a.source)))
  ))) throw new AppError("VALIDATION_ERROR", "Incomplete pilot feedback.");
}

export async function listPilot(db: AppDatabase, principal: AuthenticatedPrincipal) {
  const rows = await db.selectDistinctOn([products.id], { id: products.id, wp: products.wordpressId,
    canWrite: sql<boolean>`${reviewerAssignment(db, principal)}`, revision: entries.revision,
    submitted: entries.submitted, response: entries.response, actor: users.fullName,
    at: entries.createdAt, card: entries.card }).from(products)
    .leftJoin(entries, eq(entries.productId, products.id)).leftJoin(users, eq(entries.actorId, users.id))
    .where(and(assigned(db, principal), pilotBatch(db))).orderBy(asc(products.id), desc(entries.revision));
  const byWp = new Map(rows.map(row => [row.wp,row]));
  return pilotCards.flatMap(template => {
    const row = byWp.get(template.wp);
    if (!row) return [];
    return [{ id: row.id, card: row.card as PilotCard ?? template, revision: row.revision ?? 0,
      submitted: row.submitted ?? false, canWrite: row.canWrite, actor: row.actor, at: row.at,
      response: row.response as FeedbackResponse | null }];
  });
}
export type PilotRow = Awaited<ReturnType<typeof listPilot>>[number];

async function writableCard(db: DbExecutor, principal: AuthenticatedPrincipal, productId: string) {
  const [row] = await db.select({ wp: products.wordpressId }).from(products).where(and(eq(products.id, productId),
    assigned(db, principal), pilotBatch(db), reviewerAssignment(db, principal)));
  if (!row) throw new AppError("NOT_FOUND", "Assigned pilot card required.");
  return row;
}

export async function savePilot(db: AppDatabase, principal: AuthenticatedPrincipal, key: string, raw: z.infer<typeof feedbackInput>) {
  const parsed = feedbackInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid feedback.");
  const input = parsed.data;
  await writableCard(db, principal, input.productId);
  return executeIdempotent(db, { scope: "catalog-feedback:" + principal.userId, idempotencyKey: key, payload: input },
    tx => withDomainTransaction(tx, { userId: principal.userId }, async ctx => {
      const product = await writableCard(ctx.tx, principal, input.productId);
      await lockPilotPhotoWork(ctx.tx, principal, input.productId);
      const [previous] = await ctx.tx.select().from(entries).where(eq(entries.productId, input.productId))
        .orderBy(desc(entries.revision)).limit(1);
      if ((previous?.revision ?? 0) !== input.revision) throw new AppError("CONFLICT", "Newer feedback exists.");
      const card = previous?.card as PilotCard ?? pilotByWp.get(product.wp)!;
      validateFeedback(card, input.response, input.submit);
      if (input.response.photoId) {
        const [found] = await ctx.tx.select({ id: photos.photoId }).from(photos)
          .where(and(eq(photos.productId, input.productId), eq(photos.photoId, input.response.photoId)));
        if (!found) throw new AppError("VALIDATION_ERROR", "Unknown product photo.");
      }
      const id = createUuidV7(), revision = input.revision + 1;
      await ctx.tx.insert(entries).values({ id, revision, productId: input.productId, actorId: principal.userId,
        submitted: input.submit, response: input.response, card });
      const event = input.submit ? "CATALOG_FEEDBACK_SUBMITTED" : "CATALOG_FEEDBACK_DRAFTED";
      const payload = { productId: input.productId, revision };
      await ctx.recordAudit({ action: event, entityType: "catalog_feedback_entry", entityId: id, after: payload });
      await ctx.emitOutboxEvent({ eventType: event, aggregateType: "catalog_feedback_entry", aggregateId: id, payload, consumers: [] });
      return { status: 200, body: { id, revision } };
    }));
}

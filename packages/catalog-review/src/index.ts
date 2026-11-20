import { and, asc, desc, eq, exists, not, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import {
  catalogLegacyProducts as products, catalogReviewPhotoWork as work,
  catalogReviewDecisions as decisions, catalogReviewPhotoLinks as links,
  catalogReviewPhotos as photos, catalogReviewProposals as proposals, users,
  type AppDatabase, type DbExecutor
} from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError, createUuidV7 } from "@khidi/shared";
import { createReviewCheckpointIfReached } from "./checkpoint.ts";
export { getReviewCheckpoint, listReviewCheckpoints, markReviewCheckpointViewed } from "./checkpoint.ts";

import { assigned, pilotBatch, requireReviewProduct } from "./access.ts";
export * from "./pilot.ts";
export * from "./rounds.ts";
export { reviewRoles } from "./access.ts";
export { uploadReviewImage, requestReviewEdit, renderReviewDraft, acceptReviewDraft, rejectReviewDraft, photoForm, editInput,
  renderInput, acceptInput, rejectInput, paidPerProduct } from "./photo-work.ts";
export const reviewId = z.string().uuid();
const reviewText = z.string().min(1).max(20000).refine((value) => value.trim().length > 0);
export const textField = z.enum(["NAME", "SHORT", "FULL"]);
export const createTextInput = z.object({
  productId: reviewId, field: textField, text: reviewText,
  note: z.string().trim().max(2000).optional()
}).strict();
export type CreateTextInput = z.infer<typeof createTextInput>;
export const reviewTextSource = { NAME: "არსებული სახელი", SHORT: "არსებული მოკლე აღწერა", FULL: "არსებული სრული აღწერა" } as const;
export const decisionInput = z.object({
  proposalId: reviewId,
  revision: z.number().int().min(0),
  action: z.enum(["APPROVE", "REJECT", "EDIT", "DEFER"]),
  editedText: reviewText.optional(),
  textVersion: z.union([z.literal("PROPOSAL"), reviewId]).optional(),
  photoId: reviewId.optional(),
  note: z.string().trim().max(2000).optional()
}).strict();
export type DecisionInput = z.infer<typeof decisionInput>;

export type ReviewProductSummary = {
  id: string;
  wordpressId: number;
  recommendedOrder: number | null;
  sourceStatus: "DRAFT" | "PUBLISHED";
  name: string | null;
  category: string | null;
  total: number;
  pending: number;
  deferred: number;
  uploads?: number;
  detailRequests?: number;
};

export async function listReviewProducts(db: AppDatabase, principal: AuthenticatedPrincipal): Promise<ReviewProductSummary[]> {
  const rows = await db.select({
    id: products.id, wordpressId: products.wordpressId, sourceStatus: products.sourceStatus,
    recommendedOrder: products.recommendedOrder,
    uploads: sql<number>`(SELECT count(*)::int FROM catalog_review_photo_work WHERE product_id = ${products.id} AND kind = 'UPLOAD')`,
    detailRequests: sql<number>`(SELECT count(*)::int FROM catalog_review_photo_work WHERE product_id = ${products.id} AND kind = 'REQUEST')`,
    name: sql<string | null>`COALESCE((
      SELECT COALESCE(approved_text, edited_text) FROM catalog_review_decisions
      WHERE product_id = ${products.id} AND field = 'NAME'
      ${principal.role === "CATALOG_REVIEWER" ? sql`AND actor_id = ${principal.userId}` : sql.empty()}
      ORDER BY revision DESC LIMIT 1
    ), ${products.baseline}->>'არსებული სახელი')`,
    category: sql<string | null>`${products.baseline}->>'კატეგორია (სამუშაო)'`,
    action: sql<DecisionInput["action"] | null>`(
      SELECT action FROM catalog_review_decisions WHERE proposal_id = ${proposals.id}
      ${principal.role === "CATALOG_REVIEWER" ? sql`AND actor_id = ${principal.userId}` : sql.empty()}
      ORDER BY revision DESC LIMIT 1
    )`
  }).from(products).innerJoin(proposals, eq(proposals.productId, products.id))
    .where(assigned(db, principal)).orderBy(asc(products.wordpressId), asc(proposals.field));

  const result = new Map<string, ReviewProductSummary>();
  for (const row of rows) {
    const item = result.get(row.id) ?? { id: row.id, wordpressId: row.wordpressId, recommendedOrder: row.recommendedOrder,
      sourceStatus: row.sourceStatus, name: row.name, category: row.category,
      total: 0, pending: 0, deferred: 0, uploads: row.uploads, detailRequests: row.detailRequests };
    item.total++;
    if (!row.action) item.pending++;
    if (row.action === "DEFER") item.deferred++;
    result.set(row.id, item);
  }
  return [...result.values()];
}

export async function getReviewProduct(db: AppDatabase, principal: AuthenticatedPrincipal, productId: string) {
  const product = await requireReviewProduct(db, principal, productId);

  const [options, history, photoOptions, photoWork] = await Promise.all([
    db.select().from(proposals).where(eq(proposals.productId, product.id)),
    db.select({
      id: decisions.id, proposalId: decisions.proposalId, action: decisions.action,
      note: decisions.note, editedText: decisions.editedText, photoId: decisions.selectedPhotoId,
      approvedText: decisions.approvedText, approvedTextEditId: decisions.approvedTextEditId,
      revision: decisions.revision, createdAt: decisions.createdAt, actor: users.fullName, actorId: decisions.actorId
    }).from(decisions).innerJoin(users, eq(decisions.actorId, users.id))
      .where(eq(decisions.productId, product.id)).orderBy(desc(decisions.revision)),
    db.select({ id: links.photoId, position: links.position, audit: photos.audit })
      .from(links).innerJoin(photos, eq(links.photoId, photos.id))
      .where(eq(links.productId, product.id)).orderBy(asc(links.position)),
    db.select({ event: work, actor: users.fullName }).from(work).innerJoin(users, eq(users.id, work.actorId))
      .where(eq(work.productId, product.id)).orderBy(asc(work.createdAt), asc(work.id))
  ]);
  return { product, proposals: options, history, photos: photoOptions, photoWork };
}

export async function getReviewPhoto(db: AppDatabase, principal: AuthenticatedPrincipal, productId: string, photoId: string) {
  const product = await requireReviewProduct(db, principal, productId);
  const [photo] = await db.select({
    key: photos.previewKey, sha256: photos.previewSha256, version: photos.previewVersion
  }).from(photos).where(and(eq(photos.batchId, product.batchId), eq(photos.id, photoId), or(
    exists(db.select({ id: links.photoId }).from(links).where(and(eq(links.productId, productId), eq(links.photoId, photoId)))),
    exists(db.select({ id: work.id }).from(work).where(and(eq(work.productId, productId), eq(work.photoId, photoId))))
  )));
  if (!photo) throw new AppError("NOT_FOUND", "Catalog review photo unavailable.");
  return photo;
}

async function findProposal(db: DbExecutor, principal: AuthenticatedPrincipal, proposalId: string) {
  const [proposal] = await db.select({ proposal: proposals, batchId: products.batchId }).from(proposals)
    .innerJoin(products, eq(products.id, proposals.productId))
    .where(and(eq(proposals.id, proposalId), assigned(db, principal), not(pilotBatch(db))));
  if (!proposal) throw new AppError("NOT_FOUND", "Catalog review proposal unavailable.");
  return proposal;
}

export async function recordReviewDecision(db: AppDatabase, principal: AuthenticatedPrincipal, key: string, input: DecisionInput) {
  const parsed = decisionInput.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid catalog decision.");
  input = parsed.data;
  await findProposal(db, principal, input.proposalId);
  return executeIdempotent(db, { scope: `catalog-review:${principal.userId}`, idempotencyKey: key, payload: input },
    (tx) => withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
      const { batchId } = await findProposal(ctx.tx, principal, input.proposalId);
      if (principal.role === "CATALOG_REVIEWER") {
        await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`review-checkpoint:${batchId}:${principal.userId}`}, 0))`);
      }
      // The runtime has no UPDATE grant on proposals. Serialize by proposal without locking its row for update.
      await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.proposalId}, 0))`);
      const { proposal } = await findProposal(ctx.tx, principal, input.proposalId);
      const [last] = await ctx.tx.select({ revision: decisions.revision }).from(decisions)
        .where(eq(decisions.proposalId, proposal.id)).orderBy(desc(decisions.revision)).limit(1);
      if ((last?.revision ?? 0) !== input.revision) throw new AppError("CONFLICT", "The review has changed.");

      const isPhoto = proposal.field === "PHOTO";
      const selectedPhotoId = isPhoto && input.action === "APPROVE" ? input.photoId ?? proposal.proposedPhotoId : null;
      if ((input.action === "EDIT") !== Boolean(input.editedText) || (isPhoto && input.action === "EDIT")
        || (input.photoId && (!isPhoto || input.action !== "APPROVE"))
        || (isPhoto && input.action === "APPROVE" && !selectedPhotoId)
        || (Boolean(input.textVersion) !== (!isPhoto && input.action === "APPROVE"))
        || (proposal.origin === "MANUAL" && input.textVersion === "PROPOSAL")) {
        throw new AppError("VALIDATION_ERROR", "Decision does not match the proposal.");
      }
      let approvedText: string | null = null;
      let approvedTextEditId: string | null = null;
      if (!isPhoto && input.action === "APPROVE") {
        if (input.textVersion === "PROPOSAL") approvedText = proposal.proposed;
        else {
          const [source] = await ctx.tx.select({ text: decisions.editedText }).from(decisions).where(and(
            eq(decisions.id, input.textVersion!), eq(decisions.proposalId, proposal.id), eq(decisions.action, "EDIT")
          ));
          if (!source?.text) throw new AppError("VALIDATION_ERROR", "Text version is not available for this field.");
          approvedText = source.text;
          approvedTextEditId = input.textVersion!;
        }
      }
      if (selectedPhotoId) {
        const [linked] = await ctx.tx.select({ id: links.photoId }).from(links)
          .where(and(eq(links.productId, proposal.productId), eq(links.photoId, selectedPhotoId)));
        if (!linked) throw new AppError("VALIDATION_ERROR", "Photo is not available for this product.");
      }

      const id = createUuidV7();
      const revision = input.revision + 1;
      await ctx.tx.insert(decisions).values({
        id, proposalId: proposal.id, productId: proposal.productId, field: proposal.field, revision, actorId: principal.userId,
        action: input.action, editedText: input.editedText, approvedText, approvedTextEditId, selectedPhotoId, note: input.note || null,
        createdAt: new Date()
      });
      const summary = { proposalId: proposal.id, field: proposal.field, action: input.action, revision,
        ...(approvedText !== null ? { textVersion: input.textVersion } : {}) };
      await ctx.recordAudit({ action: "CATALOG_REVIEW_DECIDED", entityType: "catalog_review_decision", entityId: id, after: summary });
      await ctx.emitOutboxEvent({
        eventType: "CATALOG_REVIEW_DECIDED", aggregateType: "catalog_review_proposal",
        aggregateId: proposal.id, payload: summary, consumers: []
      });
      if (principal.role === "CATALOG_REVIEWER") await createReviewCheckpointIfReached(ctx, batchId, principal.userId);
      return { status: 200, body: { id, revision } };
    })
  );
}

/** Create a previously absent text field and its first edit atomically, without changing the import. */
export async function createReviewText(db: AppDatabase, principal: AuthenticatedPrincipal, key: string, rawInput: CreateTextInput) {
  const parsed = createTextInput.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid review text.");
  const input = parsed.data;
  await requireReviewProduct(db, principal, input.productId);
  return executeIdempotent(db, { scope: `catalog-review-text:${principal.userId}`, idempotencyKey: key, payload: input },
    (tx) => withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
      const product = await requireReviewProduct(ctx.tx, principal, input.productId);
      const [pilot] = await ctx.tx.select({ id: products.id }).from(products)
        .where(and(eq(products.id, product.id), pilotBatch(ctx.tx)));
      if (pilot) throw new AppError("CONFLICT", "Use the pilot response for this product.");
      if (principal.role === "CATALOG_REVIEWER") {
        await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`review-checkpoint:${product.batchId}:${principal.userId}`}, 0))`);
      }
      await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`review-text:${product.id}:${input.field}`}, 0))`);
      const [existing] = await ctx.tx.select({ id: proposals.id }).from(proposals)
        .where(and(eq(proposals.productId, product.id), eq(proposals.field, input.field)));
      if (existing) throw new AppError("CONFLICT", "This field already has a review version.");
      const proposalId = createUuidV7(), id = createUuidV7();
      const original = product.baseline[reviewTextSource[input.field]];
      await ctx.tx.insert(proposals).values({
        id: proposalId, productId: product.id, field: input.field,
        original: original == null ? null : String(original), proposed: input.text,
        observation: "Manual text entry", rationale: "Reviewer supplied a version for a field without an imported proposal.",
        origin: "MANUAL", createdBy: principal.userId
      });
      await ctx.tx.insert(decisions).values({
        id, proposalId, productId: product.id, field: input.field, revision: 1, actorId: principal.userId,
        action: "EDIT", editedText: input.text, note: input.note || null
      });
      const summary = { proposalId, productId: product.id, field: input.field, action: "EDIT", revision: 1 };
      await ctx.recordAudit({ action: "CATALOG_REVIEW_TEXT_CREATED", entityType: "catalog_review_proposal", entityId: proposalId,
        after: { field: input.field, productId: product.id, origin: "MANUAL" } });
      await ctx.recordAudit({ action: "CATALOG_REVIEW_DECIDED", entityType: "catalog_review_decision", entityId: id, after: summary });
      await ctx.emitOutboxEvent({ eventType: "CATALOG_REVIEW_DECIDED", aggregateType: "catalog_review_proposal",
        aggregateId: proposalId, payload: summary, consumers: [] });
      if (principal.role === "CATALOG_REVIEWER") await createReviewCheckpointIfReached(ctx, product.batchId, principal.userId);
      return { status: 201, body: { id, proposalId, revision: 1 } };
    })
  );
}

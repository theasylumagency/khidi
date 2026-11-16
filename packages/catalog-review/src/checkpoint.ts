import { and, asc, eq, exists, isNull, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import {
  catalogLegacyProducts as products, catalogReviewAssignments as assignments,
  catalogReviewCheckpoints as checkpoints, catalogReviewDecisions as decisions,
  catalogReviewPhotoLinks as links, catalogReviewProposals as proposals,
  type AppDatabase, type CatalogReviewCheckpointProduct, type DbExecutor
} from "@khidi/db";
import { executeIdempotent, withDomainTransaction, type DomainTransactionContext } from "@khidi/domain";
import { AppError, createUuidV7 } from "@khidi/shared";

export const REVIEW_CHECKPOINT_SIZE = 20;

function scope(db: DbExecutor, principal: AuthenticatedPrincipal) {
  return and(eq(checkpoints.reviewerId, principal.userId), exists(db.select({ userId: assignments.userId })
    .from(assignments).where(and(eq(assignments.batchId, checkpoints.batchId), eq(assignments.userId, principal.userId)))));
}

export async function listReviewCheckpoints(db: AppDatabase, principal: AuthenticatedPrincipal, batchId?: string) {
  if (principal.role !== "CATALOG_REVIEWER" || principal.authMethod === "WAREHOUSE_PIN") return [];
  return db.select({ id: checkpoints.id, batchId: checkpoints.batchId, viewedAt: checkpoints.viewedAt }).from(checkpoints)
    .where(and(scope(db, principal), batchId ? eq(checkpoints.batchId, batchId) : undefined))
    .orderBy(asc(checkpoints.createdAt));
}

export async function getReviewCheckpoint(db: DbExecutor, principal: AuthenticatedPrincipal, checkpointId: string) {
  if (principal.role !== "CATALOG_REVIEWER" || principal.authMethod === "WAREHOUSE_PIN") {
    throw new AppError("FORBIDDEN", "Reviewer access required.");
  }
  const [checkpoint] = await db.select().from(checkpoints).where(and(eq(checkpoints.id, checkpointId), scope(db, principal)));
  if (!checkpoint) throw new AppError("NOT_FOUND", "Review report not found.");
  return checkpoint;
}

export async function markReviewCheckpointViewed(db: AppDatabase, principal: AuthenticatedPrincipal, checkpointId: string) {
  await getReviewCheckpoint(db, principal, checkpointId);
  return executeIdempotent(db, {
    scope: `catalog-review-checkpoint:${principal.userId}`, idempotencyKey: checkpointId, payload: { checkpointId }
  }, (tx) => withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
    const [viewed] = await ctx.tx.update(checkpoints).set({ viewedAt: new Date() }).where(and(
      eq(checkpoints.id, checkpointId), scope(ctx.tx, principal), isNull(checkpoints.viewedAt)
    )).returning({ id: checkpoints.id });
    if (viewed) {
      await ctx.recordAudit({ action: "CATALOG_REVIEW_CHECKPOINT_VIEWED", entityType: "catalog_review_checkpoint", entityId: checkpointId });
      await ctx.emitOutboxEvent({ eventType: "CATALOG_REVIEW_CHECKPOINT_VIEWED", aggregateType: "catalog_review_checkpoint",
        aggregateId: checkpointId, payload: {}, consumers: [] });
    }
    return { status: 200, body: { id: checkpointId } };
  }));
}

/** Caller holds the reviewer/batch lock until this decision and its snapshot commit. */
export async function createReviewCheckpointIfReached(ctx: DomainTransactionContext, batchId: string, reviewerId: string) {
  const [existing] = await ctx.tx.select({ id: checkpoints.id }).from(checkpoints).where(and(
    eq(checkpoints.batchId, batchId), eq(checkpoints.reviewerId, reviewerId)
  ));
  if (existing) return;

  const rows = await ctx.tx.select({
    productId: products.id, wordpressId: products.wordpressId,
    name: sql<string | null>`${products.baseline}->>'არსებული სახელი'`,
    required: sql<number>`(SELECT count(*)::int FROM catalog_review_proposals WHERE product_id = ${products.id})`,
    field: decisions.field, action: decisions.action, note: decisions.note,
    editedText: decisions.editedText, photoPosition: links.position
  }).from(decisions)
    .innerJoin(products, eq(products.id, decisions.productId))
    .leftJoin(links, and(eq(links.productId, products.id), eq(links.photoId, decisions.selectedPhotoId)))
    .where(and(eq(products.batchId, batchId), eq(decisions.actorId, reviewerId)))
    .orderBy(asc(decisions.createdAt), asc(decisions.id));

  type Outcome = CatalogReviewCheckpointProduct["outcomes"][number];
  const byProduct = new Map<string, { wordpressId: number; name: string | null; outcomes: Map<Outcome["field"], Outcome> }>();
  const firstPass: string[] = [];
  for (const row of rows) {
    const item = byProduct.get(row.productId) ?? { wordpressId: row.wordpressId, name: row.name, outcomes: new Map() };
    const wasPassed = item.outcomes.size === row.required;
    item.outcomes.set(row.field, { field: row.field, action: row.action, note: row.note,
      editedText: row.editedText, photoPosition: row.photoPosition });
    if (!wasPassed && item.outcomes.size === row.required) firstPass.push(row.productId);
    byProduct.set(row.productId, item);
  }

  if (firstPass.length < REVIEW_CHECKPOINT_SIZE) return;
  const report = firstPass.slice(0, REVIEW_CHECKPOINT_SIZE).map((productId) => {
    const { wordpressId, name, outcomes } = byProduct.get(productId)!;
    return { wordpressId, name, outcomes: [...outcomes.values()] };
  });
  const id = createUuidV7();
  const [created] = await ctx.tx.insert(checkpoints).values({ id, batchId, reviewerId, report })
    .onConflictDoNothing().returning({ id: checkpoints.id });
  if (created) {
    const payload = { batchId, products: REVIEW_CHECKPOINT_SIZE };
    await ctx.recordAudit({ action: "CATALOG_REVIEW_CHECKPOINT_CREATED", entityType: "catalog_review_checkpoint", entityId: id, after: payload });
    await ctx.emitOutboxEvent({ eventType: "CATALOG_REVIEW_CHECKPOINT_CREATED", aggregateType: "catalog_review_checkpoint",
      aggregateId: id, payload, consumers: [] });
  }
}

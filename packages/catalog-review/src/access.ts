import { and, eq, exists, not, or, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { catalogLegacyProducts as products, catalogReviewAssignments as assignments, catalogReviewBatches as batches,
  catalogFeedbackEntries as feedback,
  catalogReviewProposals as proposals, type DbExecutor } from "@khidi/db";
import { AppError } from "@khidi/shared";
export const pilotBaseline = "21d2a98e46685a297447ad31ed486de3971dcf4bb3337d96d8146e69c7d87c79";

export const reviewRoles = ["ADMIN", "CATALOG_REVIEWER"] as const;

export function pilotBatch(db: DbExecutor) {
  return exists(db.select({ id: batches.id }).from(batches).where(and(eq(batches.id, products.batchId),
    sql`${batches.sources}->>'baseline' = ${pilotBaseline}`)));
}

// A re-import of the same archive cannot open another set of twenty products.
function pilotCohort() {
  return and(sql`EXISTS (SELECT 1 FROM catalog_feedback_round_cards c WHERE c.wordpress_id = ${products.wordpressId})`, sql`${products.batchId} = (
    SELECT b.id FROM catalog_review_batches b WHERE b.sources->>'baseline' = ${pilotBaseline}
      AND EXISTS (SELECT 1 FROM catalog_legacy_products p WHERE p.batch_id = b.id AND p.recommended_order IS NOT NULL)
    ORDER BY b.created_at, b.id LIMIT 1)`);
}

export function assigned(db: DbExecutor, principal: AuthenticatedPrincipal) {
  if (!reviewRoles.some(role => role === principal.role) || principal.authMethod === "WAREHOUSE_PIN") {
    throw new AppError("FORBIDDEN", "Catalog review access required.");
  }
  const access = principal.role === "ADMIN" ? undefined : reviewerAssignment(db, principal);
  const participating = exists(db.select({ id: batches.id }).from(batches).innerJoin(assignments, eq(assignments.batchId, batches.id))
    .where(and(eq(assignments.userId, principal.userId), sql`${batches.sources}->>'baseline' = ${pilotBaseline}`)));
  return and(access, or(pilotCohort(), and(not(pilotBatch(db)), not(participating))));
}

export function reviewerAssignment(db: DbExecutor, principal: AuthenticatedPrincipal) {
  return exists(db.select({ userId: assignments.userId }).from(assignments)
    .where(and(eq(assignments.batchId, products.batchId), eq(assignments.userId, principal.userId))));
}

export async function lockPilotPhotoWork(db: DbExecutor, principal: AuthenticatedPrincipal, productId: string) {
  const [row] = await db.select({ canWrite: sql<boolean>`${reviewerAssignment(db, principal)}` }).from(products)
    .where(and(eq(products.id, productId), pilotBatch(db)));
  if (!row) return;
  if (!row.canWrite) throw new AppError("FORBIDDEN", "Pilot reviewer assignment required.");
  // ADR-017: a round that was closed early or already decided is frozen. The shared round lock orders this check
  // against CLOSE/OPEN, which hold the same key exclusively; it is taken before the per-card lock.
  await db.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended('catalog-feedback-round',0))`);
  const frozen = (await db.execute<{ frozen: boolean }>(sql`SELECT EXISTS (
    SELECT 1 FROM catalog_feedback_round_cards c JOIN catalog_legacy_products p ON p.wordpress_id = c.wordpress_id
    WHERE p.id = ${productId} AND (EXISTS (SELECT 1 FROM catalog_feedback_round_closures x WHERE x.round_no = c.round_no)
      OR EXISTS (SELECT 1 FROM catalog_feedback_round_decisions d WHERE d.round_no = c.round_no))) AS frozen`)).rows[0];
  if (frozen?.frozen) throw new AppError("CONFLICT", "Pilot round is closed.");
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"feedback:" + productId},0))`);
  const [done] = await db.select({ id: feedback.id }).from(feedback)
    .where(and(eq(feedback.productId, productId), eq(feedback.submitted, true)));
  if (done) throw new AppError("CONFLICT", "Pilot card is already submitted.");
}

export async function requireReviewProduct(db: DbExecutor, principal: AuthenticatedPrincipal, productId: string) {
  const [product] = await db.select().from(products).where(and(eq(products.id, productId), assigned(db, principal),
    exists(db.select({ id: proposals.id }).from(proposals).where(eq(proposals.productId, products.id)))));
  if (!product) throw new AppError("NOT_FOUND", "Catalog review product unavailable.");
  return product;
}

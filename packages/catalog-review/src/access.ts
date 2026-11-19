import { and, eq, exists, inArray, not, or, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { catalogLegacyProducts as products, catalogReviewAssignments as assignments, catalogReviewBatches as batches,
  catalogFeedbackEntries as feedback,
  catalogReviewProposals as proposals, type DbExecutor } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { pilotBaseline, pilotCards } from "./pilot-cards.ts";

export const reviewRoles = ["ADMIN", "CATALOG_REVIEWER"] as const;

export function pilotBatch(db: DbExecutor) {
  return exists(db.select({ id: batches.id }).from(batches).where(and(eq(batches.id, products.batchId),
    sql`${batches.sources}->>'baseline' = ${pilotBaseline}`)));
}

// A re-import of the same archive cannot open another set of twenty products.
function pilotCohort() {
  return and(inArray(products.wordpressId, pilotCards.map(card => card.wp)), sql`${products.batchId} = (
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

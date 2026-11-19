import { and, eq, exists } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { catalogLegacyProducts as products, catalogReviewAssignments as assignments,
  catalogReviewProposals as proposals, type DbExecutor } from "@khidi/db";
import { AppError } from "@khidi/shared";

export const reviewRoles = ["ADMIN", "CATALOG_REVIEWER"] as const;

export function assigned(db: DbExecutor, principal: AuthenticatedPrincipal) {
  if (!reviewRoles.some(role => role === principal.role) || principal.authMethod === "WAREHOUSE_PIN") {
    throw new AppError("FORBIDDEN", "Catalog review access required.");
  }
  return principal.role === "ADMIN" ? undefined : exists(db.select({ userId: assignments.userId })
    .from(assignments).where(and(eq(assignments.batchId, products.batchId), eq(assignments.userId, principal.userId))));
}

export async function requireReviewProduct(db: DbExecutor, principal: AuthenticatedPrincipal, productId: string) {
  const [product] = await db.select().from(products).where(and(eq(products.id, productId), assigned(db, principal),
    exists(db.select({ id: proposals.id }).from(proposals).where(eq(proposals.productId, products.id)))));
  if (!product) throw new AppError("NOT_FOUND", "Catalog review product unavailable.");
  return product;
}

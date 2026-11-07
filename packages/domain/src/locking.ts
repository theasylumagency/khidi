import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { allocationBalances, poolSkuBalances, skus, type DbExecutor } from "@khidi/db";

export const IDENTITY_CATALOG_LOCK = "identity catalog";
export const priceLockKey = (skuId: string) => "price:" + skuId.toLowerCase();
export interface LockPlan {
  advisoryKeys?: readonly string[];
  skuIds?: readonly string[];
  poolBalances?: readonly { poolId: string; skuId: string }[];
  allocationIds?: readonly string[];
}
/** Call once with the complete plan before any dependent reads/writes. Transaction scoped. */
export async function acquireDomainLocks(tx: DbExecutor, plan: LockPlan) {
  for (const key of [...new Set(plan.advisoryKeys)].sort()) {
    if (key === IDENTITY_CATALOG_LOCK) await tx.execute(sql`SELECT pg_advisory_xact_lock(412629, 5)`);
    else await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
  const skuIds = [...new Set(plan.skuIds)].sort();
  if (skuIds.length) await tx.select({ id: skus.id }).from(skus).where(inArray(skus.id, skuIds)).orderBy(asc(skus.id)).for("update");
  const pairs = new Map((plan.poolBalances ?? []).map((p) => [p.poolId + ":" + p.skuId, p]));
  for (const [,p] of [...pairs].sort(([a],[b]) => a.localeCompare(b))) {
    // Upsert the missing zero row only after all SKU locks, in the same canonical pair order.
    await tx.insert(poolSkuBalances).values(p).onConflictDoNothing();
    await tx.select().from(poolSkuBalances).where(and(eq(poolSkuBalances.poolId,p.poolId),eq(poolSkuBalances.skuId,p.skuId))).for("update");
  }
  for (const allocationId of [...new Set(plan.allocationIds)].sort()) {
    await tx.insert(allocationBalances).values({ allocationId }).onConflictDoNothing();
    await tx.select().from(allocationBalances).where(eq(allocationBalances.allocationId,allocationId)).for("update");
  }
}

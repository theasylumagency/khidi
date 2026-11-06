import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "./client.ts";
import { skus } from "./schema.ts";

type SkuReference = Pick<typeof skus.$inferSelect, "id" | "internalSku" | "displayNameKa" | "lifecycleState" | "mergedIntoSkuId">;

/** Resolve a legacy SKU to its active survivor. A broken chain is unresolved. */
export async function resolveActiveSku(db: DbExecutor, skuId: string) {
  const visited = new Set<string>();
  let current: string | null = skuId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const [sku]: SkuReference[] = await db.select({ id: skus.id, internalSku: skus.internalSku, displayNameKa: skus.displayNameKa,
      lifecycleState: skus.lifecycleState, mergedIntoSkuId: skus.mergedIntoSkuId })
      .from(skus).where(eq(skus.id, current));
    if (!sku) return null;
    if (sku.lifecycleState !== "ARCHIVED") return sku;
    current = sku.mergedIntoSkuId;
  }
  return null;
}

/** Historical records stay with their original SKU. Follow back-links for reads. */
export async function getSkuLineageIds(db: DbExecutor, skuId: string) {
  const result = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE lineage(id) AS (
      SELECT id FROM skus WHERE id = ${skuId}
      UNION
      SELECT sku.id FROM skus sku JOIN lineage ON sku.merged_into_sku_id = lineage.id
      WHERE sku.lifecycle_state = 'ARCHIVED'
    )
    SELECT id FROM lineage
  `);
  return result.rows.map((row) => row.id);
}

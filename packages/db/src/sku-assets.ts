import { eq, inArray, or, sql } from "drizzle-orm";
import type { DbExecutor } from "./client.ts";
import { evidenceAttributions, imageAttributions, productImages, skuSplitTargets } from "./schema.ts";
import { getSkuLineageIds } from "./sku-lineage.ts";

export async function getSkuImages(db: DbExecutor, skuId: string) {
  const ids = await getSkuLineageIds(db, skuId);
  const attributions = db.select({ imageId: imageAttributions.imageId }).from(imageAttributions)
    .where(inArray(imageAttributions.targetSkuId, ids));
  return db.select().from(productImages).where(or(inArray(productImages.skuId, ids), inArray(productImages.id, attributions)));
}

export async function imageBelongsToSku(db: DbExecutor, imageId: string, skuId: string) {
  const result = await db.execute<{ available: boolean }>(sql`SELECT image_available_for_sku(${imageId}::uuid,${skuId}::uuid) AS available`);
  return result.rows[0]?.available === true;
}

export async function getSplitTargets(db: DbExecutor, skuId: string) {
  return db.select().from(skuSplitTargets).where(eq(skuSplitTargets.sourceSkuId, skuId));
}

export async function getAttributedSkuIds(db: DbExecutor, sourceSkuIds: string[]) {
  if (!sourceSkuIds.length) return [];
  const [evidence, images] = await Promise.all([
    db.select({ id: evidenceAttributions.targetSkuId }).from(evidenceAttributions).where(inArray(evidenceAttributions.sourceSkuId, sourceSkuIds)),
    db.select({ id: imageAttributions.targetSkuId }).from(imageAttributions).where(inArray(imageAttributions.sourceSkuId, sourceSkuIds))
  ]);
  return [...new Set([...evidence, ...images].map(({ id }) => id))];
}

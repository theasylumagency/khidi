import { eq, inArray, or, sql } from "drizzle-orm";
import type { DbExecutor } from "./client.ts";
import { evidenceAttributions, imageAttributions, productImages, skuSplitTargets } from "./schema.ts";
import { skus } from "./schema.ts";
import { getSkuLineageIds, resolveSkuTerminal } from "./sku-lineage.ts";
export async function getSkuImages(db: DbExecutor, skuId: string) {
    const ids = await getSkuLineageIds(db, skuId);
    const attributions = db.select({ imageId: imageAttributions.imageId }).from(imageAttributions)
        .where(inArray(imageAttributions.targetSkuId, ids));
    return db.select().from(productImages).where(or(inArray(productImages.skuId, ids), inArray(productImages.id, attributions)));
}
export async function imageBelongsToSku(db: DbExecutor, imageId: string, skuId: string) {
    const result = await db.execute<{
        available: boolean;
    }>(sql `SELECT image_available_for_sku(${imageId}::uuid,${skuId}::uuid) AS available`);
    return result.rows[0]?.available === true;
}
export async function getSplitTargets(db: DbExecutor, skuId: string) {
    return db.select().from(skuSplitTargets).where(eq(skuSplitTargets.sourceSkuId, skuId));
}
export async function getSplitCandidates(db: DbExecutor, sourceSkuId: string) {
    const pending = [sourceSkuId], visited = new Set<string>(), active = new Set<string>();
    while (pending.length) {
        const id = pending.pop()!;
        if (visited.has(id))
            continue;
        visited.add(id);
        const terminal = await resolveSkuTerminal(db, id);
        if (!terminal)
            continue;
        if (terminal.lifecycleState !== "ARCHIVED") {
            active.add(terminal.id);
            continue;
        }
        pending.push(...(await getSplitTargets(db, terminal.id)).map((row) => row.targetSkuId));
    }
    return db.select({ skuId: skus.id, internalSku: skus.internalSku, displayNameKa: skus.displayNameKa }).from(skus)
        .where(inArray(skus.id, [...active]));
}
export async function getAttributedSkuIds(db: DbExecutor, sourceSkuIds: string[]) {
    if (!sourceSkuIds.length)
        return [];
    const [evidence, images] = await Promise.all([
        db.select({ id: evidenceAttributions.targetSkuId }).from(evidenceAttributions).where(inArray(evidenceAttributions.sourceSkuId, sourceSkuIds)),
        db.select({ id: imageAttributions.targetSkuId }).from(imageAttributions).where(inArray(imageAttributions.sourceSkuId, sourceSkuIds))
    ]);
    return [...new Set([...evidence, ...images].map(({ id }) => id))];
}
export async function getAffectedSkuIds(db: DbExecutor, sourceSkuId: string) {
    const pending = [sourceSkuId], seen = new Set<string>(), result = new Set<string>();
    while (pending.length) {
        const id = pending.pop()!;
        if (seen.has(id))
            continue;
        seen.add(id);
        // A terminal split is archived, but its attributions still need invalidation.
        const terminalId=(await resolveSkuTerminal(db,id))?.id??id;
        result.add(terminalId);
        pending.push(...await getAttributedSkuIds(db, await getSkuLineageIds(db, terminalId)));
    }
    return [...result];
}

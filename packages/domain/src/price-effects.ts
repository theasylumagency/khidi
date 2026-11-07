import { asc, desc, eq, sql } from "drizzle-orm";
import { skus, storefrontPrices } from "@khidi/db";
import { AppError, createUuidV7 } from "@khidi/shared";
import type { DomainTransactionContext } from "./index.ts";

type PriceRow = typeof storefrontPrices.$inferSelect;

/** Shared transactional effects; pricing policy remains in packages/pricing. */
export async function appendStorefrontPrice(ctx: DomainTransactionContext, input: Omit<PriceRow, "id" | "setAt">, previous: PriceRow | null) {
  const [row] = await ctx.tx.insert(storefrontPrices).values({ id: createUuidV7(), ...input }).returning();
  if (!row) throw new AppError("INVARIANT_VIOLATION", "Price row was not inserted.");
  await ctx.recordAudit({ action: "STOREFRONT_PRICE_" + (row.kind === "SET" ? "SET" : "WITHDRAWN"), entityType: "storefront_price", entityId: row.id,
    before: previous, after: row, reason: row.reason ?? undefined });
  await ctx.emitOutboxEvent({ eventType: "PRICE_CHANGED", storefrontId: row.storefrontId, aggregateType: "sku", aggregateId: row.skuId,
    payload: { priceId: row.id, skuId: row.skuId, storefrontId: row.storefrontId, kind: row.kind, amount: row.basePriceMinor,
      currency: row.currency, vatIncluded: row.vatIncluded, batchId: row.batchId }, consumers: ["storefront:" + row.storefrontId] });
  return row;
}

/** Catalog corrections retain the source's price history and never copy a price. */
export async function withdrawArchivedSkuPrices(ctx: DomainTransactionContext, skuId: string, reason: "SKU merged" | "SKU split") {
  const [source] = await ctx.tx.select().from(skus).where(eq(skus.id, skuId)).for("update");
  if (!ctx.actor.userId || source?.lifecycleState !== "ARCHIVED") throw new AppError("PRECONDITION_FAILED", "Only an archived correction source can have prices withdrawn here.");
  const latest = await ctx.tx.selectDistinctOn([storefrontPrices.storefrontId]).from(storefrontPrices).where(eq(storefrontPrices.skuId, skuId))
    .orderBy(asc(storefrontPrices.storefrontId), desc(storefrontPrices.setAt), desc(storefrontPrices.id));
  const current = latest.filter((row) => row.kind === "SET");
  const batchId = createUuidV7();
  for (const price of current) {
    await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"price:" + price.storefrontId + ":" + skuId}, 0))`);
    await appendStorefrontPrice(ctx, { skuId, storefrontId: price.storefrontId, kind: "WITHDRAWN", basePriceMinor: null,
      currency: price.currency, vatIncluded: price.vatIncluded, setBy: ctx.actor.userId, reason, source: "MANUAL", batchId }, price);
  }
  return { batchId, priceIds: current.map((price) => price.id) };
}

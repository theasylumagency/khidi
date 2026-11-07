import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { legalEntities, skus, storefrontPrices, storefronts, userPermissions, users, type DbExecutor } from "@khidi/db";
import { withDomainTransaction, type DomainActor } from "@khidi/domain";
import { appendStorefrontPrice } from "@khidi/domain/price-effects";
import { acquireDomainLocks, priceLockKey } from "@khidi/domain/locking";
import { AppError, CURRENCY_GEL, createUuidV7 } from "@khidi/shared";

export const DEFAULT_PRICE_CURRENCY = CURRENCY_GEL;
export const DEFAULT_LARGE_PRICE_CHANGE_RATIO = 0.3;
export const MAX_PRICE_MINOR = 2_147_483_647;
export type PriceRow = typeof storefrontPrices.$inferSelect;

export const priceChangeSchema = z.object({
  skuId: z.string().uuid(), storefrontId: z.string().uuid(), kind: z.enum(["SET", "WITHDRAWN"]).default("SET"),
  basePriceMinor: z.number().int().positive().max(MAX_PRICE_MINOR).optional(), currency: z.literal("GEL").default("GEL"),
  vatIncluded: z.boolean().optional(), expectedPriceId: z.string().uuid().nullable().optional()
}).strict().superRefine((change, ctx) => {
  if ((change.kind === "SET") !== (change.basePriceMinor !== undefined)) ctx.addIssue({ code: "custom", message: "SET requires an amount; WITHDRAWN forbids it." });
});
const batchSchema = z.object({
  changes: z.array(priceChangeSchema).min(1).max(1000), source: z.enum(["MANUAL", "BULK", "CSV_IMPORT"]).default("MANUAL"),
  reason: z.string().trim().min(1).max(1000).optional(), confirmLargeChanges: z.boolean().default(false)
}).strict();
export type PriceChange = z.input<typeof priceChangeSchema>;
export type PriceBatch = z.input<typeof batchSchema>;
function parseBatch(raw: unknown) {
  const parsed = batchSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid price changes.");
  const input = parsed.data;
  if (input.source === "MANUAL" && input.changes.length !== 1) throw new AppError("VALIDATION_ERROR", "Manual changes contain one row.");
  if (input.source !== "MANUAL" && input.changes.some((row) => row.expectedPriceId === undefined)) {
    throw new AppError("VALIDATION_ERROR", "Bulk and CSV changes require an expected price ID (null for a first price).");
  }
  if (input.source === "CSV_IMPORT" && input.changes.some((row) => row.kind === "WITHDRAWN")) throw new AppError("VALIDATION_ERROR", "CSV imports cannot withdraw prices.");
  const keys = input.changes.map((row) => `${row.storefrontId}:${row.skuId}`);
  if (new Set(keys).size !== keys.length) throw new AppError("VALIDATION_ERROR", "Duplicate price rows.");
  return input;
}

/** Database permissions remain authoritative even when a transport principal is stale. */
export async function assertPriceAccess(db: DbExecutor, actor: DomainActor, edit = false) {
  const [user] = actor.userId ? await db.select().from(users).where(and(eq(users.id, actor.userId), eq(users.active, true))) : [];
  if (!user || user.role === "WAREHOUSE") throw new AppError("FORBIDDEN", "Price access denied.");
  const [grant] = await db.select().from(userPermissions).where(and(eq(userPermissions.userId, user.id), eq(userPermissions.permissionKey, "price.edit")));
  if (user.role !== "ADMIN" && !grant && (edit || user.role !== "OPERATOR")) throw new AppError("FORBIDDEN", "Price access denied.");
  return user;
}
export function largePriceChangeRatio() {
  const configured = process.env.PRICE_LARGE_CHANGE_RATIO?.trim();
  const ratio = configured ? Number(configured) : DEFAULT_LARGE_PRICE_CHANGE_RATIO;
  if (!Number.isFinite(ratio) || ratio < 0) throw new AppError("PRECONDITION_FAILED", "Invalid price change threshold.");
  return ratio;
}

/** Server-internal lookups. Transports authorize before exposing prices. */
export async function getLatestPriceRow(db: DbExecutor, skuId: string, storefrontId: string) {
  const [row] = await db.select().from(storefrontPrices).where(and(eq(storefrontPrices.skuId, skuId), eq(storefrontPrices.storefrontId, storefrontId)))
    .orderBy(desc(storefrontPrices.setAt), desc(storefrontPrices.id)).limit(1);
  return row ?? null;
}
export async function getCurrentPrice(db: DbExecutor, skuId: string, storefrontId: string) {
  const row = await getLatestPriceRow(db, skuId, storefrontId);
  return row?.kind === "SET" ? row : null;
}
export async function listLatestPrices(db: DbExecutor, filter: { skuId?: string; skuIds?: readonly string[]; storefrontId?: string } = {}) {
  return db.selectDistinctOn([storefrontPrices.skuId, storefrontPrices.storefrontId]).from(storefrontPrices)
    .where(and(filter.skuId ? eq(storefrontPrices.skuId, filter.skuId) : undefined, filter.skuIds ? inArray(storefrontPrices.skuId, [...filter.skuIds]) : undefined,
      filter.storefrontId ? eq(storefrontPrices.storefrontId, filter.storefrontId) : undefined))
    .orderBy(asc(storefrontPrices.skuId), asc(storefrontPrices.storefrontId), desc(storefrontPrices.setAt), desc(storefrontPrices.id));
}
export async function getPriceHistory(db: DbExecutor, actor: DomainActor, skuId: string, storefrontId?: string) {
  await assertPriceAccess(db, actor);
  return db.select({ price: storefrontPrices, authorName: users.fullName })
    .from(storefrontPrices).innerJoin(users, eq(users.id, storefrontPrices.setBy))
    .where(and(eq(storefrontPrices.skuId, skuId), storefrontId ? eq(storefrontPrices.storefrontId, storefrontId) : undefined))
    .orderBy(desc(storefrontPrices.setAt), desc(storefrontPrices.id));
}

async function prepare(db: DbExecutor, actor: DomainActor, input: ReturnType<typeof parseBatch>) {
  const user = await assertPriceAccess(db, actor, true);
  const ratio = largePriceChangeRatio();
  const storeIds = [...new Set(input.changes.map((row) => row.storefrontId))];
  const skuIds = [...new Set(input.changes.map((row) => row.skuId))];
  const [stores, products, latest] = await Promise.all([
    db.select({ store: storefronts, seller: legalEntities }).from(storefronts).innerJoin(legalEntities, eq(legalEntities.id, storefronts.sellerEntityId)).where(inArray(storefronts.id, storeIds)),
    db.select({ id: skus.id, state: skus.lifecycleState }).from(skus).where(inArray(skus.id, skuIds)),
    db.selectDistinctOn([storefrontPrices.skuId, storefrontPrices.storefrontId]).from(storefrontPrices)
      .where(and(inArray(storefrontPrices.skuId, skuIds), inArray(storefrontPrices.storefrontId, storeIds)))
      .orderBy(asc(storefrontPrices.skuId), asc(storefrontPrices.storefrontId), desc(storefrontPrices.setAt), desc(storefrontPrices.id))
  ]);
  const byStore = new Map(stores.map((row) => [row.store.id, row]));
  const existingSkus = new Set(products.map((row) => row.id));
  const archivedSkus = new Set(products.filter((row) => row.state === "ARCHIVED").map((row) => row.id));
  const byPair = new Map(latest.map((row) => [`${row.storefrontId}:${row.skuId}`, row]));
  return input.changes.map((change) => {
    const target = byStore.get(change.storefrontId);
    if (!target || !existingSkus.has(change.skuId)) throw new AppError("NOT_FOUND", "SKU or storefront not found.");
    if (archivedSkus.has(change.skuId)) throw new AppError("PRECONDITION_FAILED", "Archived SKUs cannot have price changes.");
    const previous = byPair.get(`${change.storefrontId}:${change.skuId}`) ?? null;
    if (change.expectedPriceId !== undefined && change.expectedPriceId !== (previous?.id ?? null)) throw new AppError("CONFLICT", "Price changed after preview. Refresh the preview.");
    const defaultVat = previous?.vatIncluded ?? target.seller.pricesIncludeVat;
    const vatIncluded = change.vatIncluded ?? defaultVat;
    if (user.role !== "ADMIN" && vatIncluded !== defaultVat) throw new AppError("FORBIDDEN", "Only admins may change the existing VAT flag or override first-price seller VAT.");
    const current = previous?.kind === "SET" ? previous : null;
    const deltaMinor = current && change.kind === "SET" ? change.basePriceMinor! - current.basePriceMinor! : null;
    const differenceRatio = deltaMinor !== null ? deltaMinor / current!.basePriceMinor! : null;
    const unchanged = change.kind === "WITHDRAWN" ? !current : !!current && current.basePriceMinor === change.basePriceMinor && current.vatIncluded === vatIncluded;
    const largeChange = !unchanged && differenceRatio !== null && Math.abs(differenceRatio) >= ratio;
    return { ...change, vatIncluded, expectedPriceId: previous?.id ?? null, previous, deltaMinor, differenceRatio, largeChange, unchanged };
  });
}
export async function previewPriceChanges(db: DbExecutor, actor: DomainActor, raw: PriceBatch) {
  return prepare(db, actor, parseBatch(raw));
}
export async function commitPriceChanges(db: DbExecutor, actor: DomainActor, raw: PriceBatch) {
  const input = parseBatch(raw);
  return withDomainTransaction(db, actor, async (ctx) => {
    await assertPriceAccess(ctx.tx, actor, true);
    const skuIds = [...new Set(input.changes.map((row) => row.skuId))];
    await acquireDomainLocks(ctx.tx, { advisoryKeys: skuIds.map(priceLockKey), skuIds });
    const preview = await prepare(ctx.tx, actor, input);
    if (preview.some((row) => row.kind === "WITHDRAWN") && !input.reason) throw new AppError("VALIDATION_ERROR", "Withdrawal requires a reason.");
    if (preview.some((row) => row.largeChange) && (!input.confirmLargeChanges || !input.reason)) throw new AppError("PRECONDITION_FAILED", "Large price changes require confirmation and a reason.");
    const batchId = input.source === "MANUAL" ? null : createUuidV7();
    const rows: PriceRow[] = [];
    for (const change of preview.filter((row) => !row.unchanged)) {
      const row = await appendStorefrontPrice(ctx, { skuId: change.skuId, storefrontId: change.storefrontId, kind: change.kind,
        basePriceMinor: change.basePriceMinor ?? null, currency: change.currency, vatIncluded: change.vatIncluded,
        setBy: actor.userId!, reason: input.reason ?? null, batchId, source: input.source }, change.previous);
      rows.push(row);
    }
    return { batchId, rows };
  });
}
export async function setPrice(db: DbExecutor, actor: DomainActor, change: Omit<PriceChange, "kind">, options: { reason?: string; confirmLargeChanges?: boolean } = {}) {
  return commitPriceChanges(db, actor, { ...options, changes: [{ ...change, kind: "SET" }], source: "MANUAL" });
}
export async function withdrawPrice(db: DbExecutor, actor: DomainActor, change: Pick<PriceChange, "skuId" | "storefrontId" | "expectedPriceId">, reason: string) {
  return commitPriceChanges(db, actor, { changes: [{ skuId: change.skuId, storefrontId: change.storefrontId,
    expectedPriceId: change.expectedPriceId, kind: "WITHDRAWN" }], reason, source: "MANUAL" });
}

export async function getCorrectionPriceImpact(db: DbExecutor, actor: DomainActor, sourceSkuId: string, targetSkuIds: string[]) {
  await assertPriceAccess(db, actor);
  const [prices, stores] = await Promise.all([
    listLatestPrices(db, { skuIds: [sourceSkuId, ...targetSkuIds] }), db.select({ id: storefronts.id, name: storefronts.name }).from(storefronts)
  ]);
  const current = prices.filter((row) => row.kind === "SET");
  return {
    sourcePrices: current.filter((row) => row.skuId === sourceSkuId).map((row) => ({ storefrontId: row.storefrontId,
      storefrontName: stores.find((store) => store.id === row.storefrontId)?.name ?? "", amount: row.basePriceMinor!, vatIncluded: row.vatIncluded })),
    pricedStorefrontsBySku: Object.fromEntries(targetSkuIds.map((skuId) => [skuId, current.filter((row) => row.skuId === skuId).map((row) => row.storefrontId)]))
  };
}
export type CorrectionPriceImpact = Awaited<ReturnType<typeof getCorrectionPriceImpact>>;

export async function copyPricePreview(db: DbExecutor, actor: DomainActor, sourceStorefrontId: string, targetStorefrontId: string, skuIds: string[], expectedPriceIds: Record<string, string | null>) {
  await assertPriceAccess(db, actor, true);
  if (!z.string().uuid().safeParse(sourceStorefrontId).success || !z.string().uuid().safeParse(targetStorefrontId).success
    || sourceStorefrontId === targetStorefrontId || !z.array(z.string().uuid()).min(1).max(1000).safeParse(skuIds).success) {
    throw new AppError("VALIDATION_ERROR", "Invalid price copy selection.");
  }
  const expected = z.record(z.string().uuid().nullable()).safeParse(expectedPriceIds);
  if (!expected.success || skuIds.some((skuId) => expected.data[skuId] === undefined)) throw new AppError("VALIDATION_ERROR", "Copying prices requires an expected destination price ID for every SKU.");
  const source = new Map((await listLatestPrices(db, { storefrontId: sourceStorefrontId })).filter((row) => row.kind === "SET").map((row) => [row.skuId, row]));
  const changes = skuIds.map((skuId) => {
    const row = source.get(skuId);
    if (!row) throw new AppError("PRECONDITION_FAILED", "A selected SKU has no source price.");
    return { skuId, storefrontId: targetStorefrontId, basePriceMinor: row.basePriceMinor!, expectedPriceId: expected.data[skuId]! };
  });
  return previewPriceChanges(db, actor, { changes, source: "BULK" });
}

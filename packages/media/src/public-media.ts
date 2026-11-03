import { and, asc, eq, ne, sql } from "drizzle-orm";
import { type DbExecutor, type MediaDerivative, imagePublications, productImages, skus, storefronts } from "@khidi/db";
import { withDomainTransaction, type DomainTransactionContext } from "@khidi/domain";
import { AppError, createUuidV7 } from "@khidi/shared";
import type { MediaStorage } from "./storage.ts";
const INTERNAL_ID = /kh-[0-9]{6,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export function publicMediaKey(slug: string, ordinal: number, width: number, format: string, hubHost = process.env.HUB_NEUTRAL_DOMAIN ?? "khidi.internal.local") {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 450 || INTERNAL_ID.test(slug) || slug.includes(hubHost.toLowerCase().replaceAll(".", "-"))
    || !Number.isSafeInteger(ordinal) || ordinal < 1 || ![400, 800, 1600].includes(width) || !["webp", "avif"].includes(format)) throw new AppError("VALIDATION_ERROR", "Unsafe public media name.");
  return `${slug}-${ordinal}-${width}.${format}`;
}
export function buildPublicMediaUrl(mediaBaseUrl: string, key: string, hubHost = process.env.HUB_NEUTRAL_DOMAIN ?? "khidi.internal.local") {
  let base: URL; try { base = new URL(mediaBaseUrl); } catch { throw new AppError("VALIDATION_ERROR", "Invalid storefront media URL."); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.hostname === hubHost || base.hostname.endsWith(`.${hubHost}`)
    || INTERNAL_ID.test(decodeURIComponent(base.pathname)) || !/^[a-z0-9-]+-[1-9][0-9]*-(400|800|1600)\.(webp|avif)$/.test(key) || INTERNAL_ID.test(key)) throw new AppError("VALIDATION_ERROR", "Unsafe storefront media URL.");
  base.pathname = `${base.pathname.replace(/\/$/, "")}/${key}`; return base.toString();
}
interface DesiredCopy { imageId: string; skuId: string; version: number; key: string; derivative: MediaDerivative }
async function desiredCopies(ctx: DomainTransactionContext, skuId: string): Promise<DesiredCopy[]> {
  await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`media-publication:${skuId}`}))`);
  const [sku] = await ctx.tx.select().from(skus).where(eq(skus.id, skuId)).for("no key update");
  if (!sku) throw new AppError("NOT_FOUND", "SKU not found.");
  if (sku.lifecycleState !== "READY" || !sku.canonicalSlug) return [];
  try { publicMediaKey(sku.canonicalSlug, 1, 400, "webp"); } catch { return []; }
  const images = await ctx.tx.select().from(productImages).where(and(eq(productImages.skuId, skuId), eq(productImages.status, "VERIFIED"), eq(productImages.usage, "PUBLIC"))).orderBy(asc(productImages.sortOrder), asc(productImages.createdAt), asc(productImages.id)).for("update");
  images.sort((a, b) => Number(b.role === "MAIN") - Number(a.role === "MAIN"));
  const copies: DesiredCopy[] = [];
  for (const [index, image] of images.entries()) for (const derivative of Object.values(image.derivativesJson)) copies.push({ imageId: image.id, skuId, version: image.masterVersion, key: publicMediaKey(sku.canonicalSlug, index + 1, derivative.width, derivative.format), derivative });
  return copies;
}
function sameCopy(row: typeof imagePublications.$inferSelect, copy: DesiredCopy) { return row.imageId === copy.imageId && row.masterVersion === copy.version && row.objectKey === copy.key && row.sha256 === copy.derivative.sha256; }
async function auditCopy(ctx: DomainTransactionContext, id: string, status: string, key: string) {
  await ctx.recordAudit({ action: "IMAGE_PUBLICATION_CHANGED", entityType: "image_publication", entityId: id, after: { status, objectKey: key } });
  await ctx.emitOutboxEvent({ eventType: "IMAGE_PUBLICATION_CHANGED", aggregateType: "image_publication", aggregateId: id, payload: { status, objectKey: key }, consumers: [] });
}
async function prepareCopies(db: DbExecutor, skuId: string) {
  return withDomainTransaction(db, {}, async (ctx) => {
    const desired = await desiredCopies(ctx, skuId);
    const existing = await ctx.tx.select().from(imagePublications).where(and(eq(imagePublications.skuId, skuId), ne(imagePublications.status, "WITHDRAWN"))).for("update");
    const stale = existing.filter((row) => row.status === "WITHDRAWING" || !desired.some((copy) => sameCopy(row, copy)));
    for (const row of stale) if (row.status !== "WITHDRAWING") {
      await ctx.tx.update(imagePublications).set({ status: "WITHDRAWING" }).where(eq(imagePublications.id, row.id)); await auditCopy(ctx, row.id, "WITHDRAWING", row.objectKey);
    }
    // Retire old occupants before reusing a neutral slug-position object name.
    if (stale.length) return { stale: stale.map((row) => row.id), pending: [] as string[] };
    const pending: string[] = [];
    for (const copy of desired) {
      const current = existing.find((row) => sameCopy(row, copy));
      if (current) { if (current.status === "PENDING") pending.push(current.id); continue; }
      const id = createUuidV7(); await ctx.tx.insert(imagePublications).values({ id, imageId: copy.imageId, skuId, masterVersion: copy.version, objectKey: copy.key,
        width: copy.derivative.width, format: copy.derivative.format, sha256: copy.derivative.sha256, status: "PENDING" });
      await auditCopy(ctx, id, "PENDING", copy.key); pending.push(id);
    }
    return { stale: [] as string[], pending };
  });
}
async function withdrawCopy(db: DbExecutor, storage: MediaStorage, skuId: string, id: string) {
  await withDomainTransaction(db, {}, async (ctx) => {
    await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`media-publication:${skuId}`}))`);
    const [row] = await ctx.tx.select().from(imagePublications).where(eq(imagePublications.id, id)).for("update");
    if (!row || row.status !== "WITHDRAWING") return;
    await storage.removePublic(row.objectKey);
    await ctx.tx.update(imagePublications).set({ status: "WITHDRAWN", withdrawnAt: new Date() }).where(eq(imagePublications.id, row.id)); await auditCopy(ctx, row.id, "WITHDRAWN", row.objectKey);
  });
}
async function transferCopy(db: DbExecutor, storage: MediaStorage, skuId: string, id: string) {
  await withDomainTransaction(db, {}, async (ctx) => {
    const desired = await desiredCopies(ctx, skuId);
    const [row] = await ctx.tx.select().from(imagePublications).where(eq(imagePublications.id, id)).for("update");
    if (!row || row.status !== "PENDING") return;
    const copy = desired.find((copy) => sameCopy(row, copy));
    if (!copy) { await ctx.tx.update(imagePublications).set({ status: "WITHDRAWING" }).where(eq(imagePublications.id, id)); await auditCopy(ctx, id, "WITHDRAWING", row.objectKey); return; }
    const bytes = await storage.readPrivate(copy.derivative.key, copy.derivative.sha256, copy.derivative.versionId);
    await storage.putPublic(copy.key, bytes, copy.derivative.contentType);
    await ctx.tx.update(imagePublications).set({ status: "PUBLISHED", publishedAt: new Date() }).where(eq(imagePublications.id, id)); await auditCopy(ctx, id, "PUBLISHED", copy.key);
  });
}
/** Durable intent precedes each object write; retries can also remove partial transfers. */
export async function synchronizePublicMedia(db: DbExecutor, storage: MediaStorage, skuId: string) {
  for (let round = 0; round < 5; round++) {
    const plan = await prepareCopies(db, skuId);
    if (plan.stale.length) { for (const id of plan.stale) await withdrawCopy(db, storage, skuId, id); continue; }
    for (const id of plan.pending) await transferCopy(db, storage, skuId, id);
    const after = await prepareCopies(db, skuId);
    if (!after.stale.length && !after.pending.length) {
      const [sku] = await db.select({ slug: skus.canonicalSlug, state: skus.lifecycleState }).from(skus).where(eq(skus.id, skuId)).limit(1);
      if (sku?.state === "READY" && sku.slug) publicMediaKey(sku.slug, 1, 400, "webp");
      return;
    }
  }
  throw new Error("Media eligibility changed during publication; retry required.");
}
export async function listStorefrontMedia(db: DbExecutor, skuId: string, storefrontId: string) {
  const [storefront] = await db.select({ baseUrl: storefronts.mediaBaseUrl }).from(storefronts).where(eq(storefronts.id, storefrontId)).limit(1);
  if (!storefront) throw new AppError("NOT_FOUND", "Storefront not found.");
  const rows = await db.select({ publication: imagePublications, image: productImages, sku: skus }).from(imagePublications).innerJoin(productImages, eq(productImages.id, imagePublications.imageId)).innerJoin(skus, eq(skus.id, imagePublications.skuId))
    .where(and(eq(skus.id, skuId), eq(skus.lifecycleState, "READY"), eq(productImages.status, "VERIFIED"), eq(productImages.usage, "PUBLIC"), eq(imagePublications.status, "PUBLISHED"))).orderBy(asc(productImages.sortOrder), asc(imagePublications.width), asc(imagePublications.format));
  return rows.filter(({ publication: row, image, sku }) => row.masterVersion === image.masterVersion && sku.canonicalSlug && row.objectKey.startsWith(`${sku.canonicalSlug}-`)).map(({ publication: row, image }) => ({ url: buildPublicMediaUrl(storefront.baseUrl, row.objectKey), width: row.width, format: row.format, role: image.role }));
}

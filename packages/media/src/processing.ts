import sharp from "sharp";
import { and, eq, ne, sql } from "drizzle-orm";
import { type MediaDerivative, imageMasterVersions, productImages } from "@khidi/db";
import type { DomainTransactionContext } from "@khidi/domain";
import { AppError, createUuidV7 } from "@khidi/shared";
import { digest, StorageExistsError, type MediaStorage } from "./storage.ts";
import { configuredQuality } from "./upload.ts";
import { queueMediaJob } from "./transactions.ts";

const BACKGROUND = "#f5f5f4";
export const DERIVATIVE_WIDTHS = [400, 800, 1600] as const;
export async function putRetained(storage: MediaStorage, key: string, bytes: Uint8Array, contentType: string) {
  try { return await storage.putPrivate(key, bytes, contentType); }
  catch (error) {
    if (!(error instanceof StorageExistsError)) throw error;
    const sha256 = digest(bytes); await storage.readPrivate(key, sha256);
    return { key, sha256, bytes: bytes.byteLength, contentType };
  }
}
export async function renderImage(raw: Uint8Array) {
  const source = sharp(raw, { limitInputPixels: 64_000_000, failOn: "warning" });
  const metadata = await source.metadata();
  const edge = Math.min(4096, Math.max(1920, metadata.width ?? 0, metadata.height ?? 0));
  const padding = Math.floor(edge * .05), inner = edge - padding * 2;
  // Sharp strips metadata by default. No withMetadata/keepMetadata/withExif calls.
  const master = await source.rotate().toColourspace("srgb").flatten({ background: BACKGROUND })
    .resize(inner, inner, { fit: "contain", background: BACKGROUND })
    .extend({ top: padding, bottom: padding, left: padding, right: padding, background: BACKGROUND })
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toBuffer();
  const derivatives = await Promise.all(DERIVATIVE_WIDTHS.flatMap((width) => (["webp", "avif"] as const).map(async (format) => {
    const pipeline = sharp(master).resize(width, width).toColourspace("srgb");
    const bytes = format === "webp" ? await pipeline.webp({ quality: 85 }).toBuffer() : await pipeline.avif({ quality: 65, effort: 2 }).toBuffer();
    return { width, format, bytes, contentType: `image/${format}` };
  })));
  return { master, edge, derivatives };
}
export async function processImage(ctx: DomainTransactionContext, storage: MediaStorage, imageId: string, version: number) {
  const [image] = await ctx.tx.select().from(productImages).where(eq(productImages.id, imageId)).for("update");
  if (!image || version > image.requestedVersion) throw new AppError("NOT_FOUND", "Requested image version not found.");
  const [existing] = await ctx.tx.select().from(imageMasterVersions).where(and(eq(imageMasterVersions.imageId, imageId), eq(imageMasterVersions.version, version))).limit(1);
  if (existing) return;
  const raw = await storage.readPrivate(image.rawStorageKey, image.rawSha256, image.rawVersionId ?? undefined);
  const rendered = await renderImage(raw), prefix = `master/${imageId}/v${version}`;
  const master = await putRetained(storage, `${prefix}/master.jpg`, rendered.master, "image/jpeg");
  const derivatives: Record<string, MediaDerivative> = {};
  for (const derivative of rendered.derivatives) {
    const object = await putRetained(storage, `${prefix}/${derivative.width}.${derivative.format}`, derivative.bytes, derivative.contentType);
    derivatives[`${derivative.width}.${derivative.format}`] = { ...object, width: derivative.width, format: derivative.format };
  }
  await ctx.tx.insert(imageMasterVersions).values({ id: createUuidV7(), imageId, version, storageKey: master.key, sha256: master.sha256, storageVersionId: master.versionId,
    bytes: master.bytes, width: rendered.edge, height: rendered.edge, derivativesJson: derivatives });
  if (version >= image.masterVersion) await ctx.tx.update(productImages).set({ masterVersion: version, masterStorageKey: master.key, masterSha256: master.sha256,
    derivativesJson: derivatives, processingStatus: version === image.requestedVersion ? "COMPLETED" : "PENDING", tier2QualityJson: null, perceptualHash: null, updatedAt: new Date() }).where(eq(productImages.id, imageId));
  await ctx.recordAudit({ action: "IMAGE_PROCESSED", entityType: "product_image", entityId: imageId, after: { version, masterSha256: master.sha256, derivatives: Object.keys(derivatives) } });
  await ctx.emitOutboxEvent({ eventType: "IMAGE_PROCESSED", aggregateType: "product_image", aggregateId: imageId, payload: { version }, consumers: [] });
  await queueMediaJob(ctx, "tier2-image-check", { imageId, imageVersion: version }, `tier2:${imageId}:${version}`);
  if (image.skuId) await queueMediaJob(ctx, "publish-sku-media", { skuId: image.skuId });
}
export async function perceptualHash(bytes: Uint8Array) {
  const pixels = await sharp(bytes).resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  let value = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) value = value << 1n | (pixels[y * 9 + x]! > pixels[y * 9 + x + 1]! ? 1n : 0n);
  return value.toString(16).padStart(16, "0");
}
export function hashDistance(left: string, right: string) {
  if (![left, right].every((hash) => /^[a-f0-9]{16}$/.test(hash))) throw new Error("Invalid perceptual hash.");
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`), count = 0;
  while (bits) { bits &= bits - 1n; count++; } return count;
}
export async function tier2ImageCheck(ctx: DomainTransactionContext, storage: MediaStorage, imageId: string, version: number) {
  const [image] = await ctx.tx.select().from(productImages).where(eq(productImages.id, imageId)).for("update");
  if (!image) throw new AppError("NOT_FOUND", "Image not found.");
  if (image.masterVersion !== version) return;
  const [master] = await ctx.tx.select().from(imageMasterVersions).where(and(eq(imageMasterVersions.imageId, imageId), eq(imageMasterVersions.version, version))).limit(1);
  if (!master) throw new AppError("PRECONDITION_FAILED", "Master processing pending.");
  const bytes = await storage.readPrivate(master.storageKey, master.sha256, master.storageVersionId ?? undefined), hash = await perceptualHash(bytes);
  const threshold = Number(process.env.MEDIA_PHASH_MAX_DISTANCE ?? 6);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 64) throw new Error("Invalid perceptual hash threshold.");
  // A SKU lock serializes first-time checks, so simultaneous candidates see each other.
  if (image.skuId) await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`media-phash:${image.skuId}`}))`);
  const candidates = image.skuId ? await ctx.tx.select({ id: productImages.id, hash: productImages.perceptualHash }).from(productImages).where(and(eq(productImages.skuId, image.skuId), ne(productImages.id, imageId))) : [];
  const nearDuplicates = candidates.filter((candidate) => candidate.hash && hashDistance(hash, candidate.hash) <= threshold).map((candidate) => ({ imageId: candidate.id, distance: hashDistance(hash, candidate.hash!) }));
  const quality = { minResolutionPassed: Math.max(image.width, image.height) >= configuredQuality().minLongEdge, nearDuplicates, distanceThreshold: threshold,
    scope: image.skuId ? "SAME_SKU" : "AWAITING_SKU", checkedVersion: version };
  await ctx.tx.update(productImages).set({ perceptualHash: hash, tier2QualityJson: quality, updatedAt: new Date() }).where(eq(productImages.id, imageId));
  await ctx.recordAudit({ action: "IMAGE_TIER2_CHECKED", entityType: "product_image", entityId: imageId, after: quality });
  await ctx.emitOutboxEvent({ eventType: "IMAGE_TIER2_CHECKED", aggregateType: "product_image", aggregateId: imageId, payload: quality, consumers: [] });
}

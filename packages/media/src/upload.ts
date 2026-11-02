import sharp from "sharp";
import { eq } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, productImages } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError, sha256Hex } from "@khidi/shared";
import { MAX_PHOTO_BYTES, photoUploadSchema } from "./contracts.ts";
import { DEFAULT_QUALITY_CONFIG, evaluatePhotoQuality, qualityConfig, type QualityConfig } from "./quality.ts";
import { assertMediaPrincipal } from "./principal.ts";
import { mediaReceipt, queueMediaJob, recordMediaReceipt } from "./transactions.ts";
import { refreshIntakePhotoStatus, resolveUploadTarget } from "./targets.ts";
import { digest, privateImageKey, StorageExistsError, type MediaStorage } from "./storage.ts";
import { sniffPhotoMime } from "./formats.ts";

export function configuredQuality(env: NodeJS.ProcessEnv = process.env): QualityConfig {
  try { return qualityConfig(env.MEDIA_QUALITY_CONFIG ? JSON.parse(env.MEDIA_QUALITY_CONFIG) : {}); }
  catch { throw new Error("Invalid MEDIA_QUALITY_CONFIG."); }
}
export async function inspectPhoto(bytes: Uint8Array, config = DEFAULT_QUALITY_CONFIG) {
  if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES) throw new AppError("VALIDATION_ERROR", "Photo exceeds size limit.", { mediaReason: "FILE_TOO_LARGE" });
  const b = Buffer.from(bytes);
  const mime = sniffPhotoMime(bytes);
  if (!mime) throw new AppError("VALIDATION_ERROR", "Unsupported image format.", { mediaReason: "UNSUPPORTED_FORMAT" });
  try {
    const image = sharp(b, { limitInputPixels: 64_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1 || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) throw new Error("Invalid raster image.");
    const sample = await image.autoOrient().resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true }).flatten({ background: "#f5f5f4" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const quality = evaluatePhotoQuality({ width: metadata.width, height: metadata.height, gray: sample.data, sampleWidth: sample.info.width, sampleHeight: sample.info.height }, config);
    if (!quality.passed) throw new AppError("VALIDATION_ERROR", "Photo requires a retake.", { mediaReason: quality.reasons[0], quality });
    return { mime, width: metadata.width, height: metadata.height, quality };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("VALIDATION_ERROR", "The image could not be decoded safely.", { mediaReason: "UNSUPPORTED_FORMAT" });
  }
}

export async function receivePhoto(db: DbExecutor, storage: MediaStorage, principal: AuthenticatedPrincipal, rawInput: unknown, bytes: Uint8Array, config = configuredQuality()) {
  await assertMediaPrincipal(db, principal);
  const parsed = photoUploadSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid photo metadata.");
  const input = parsed.data;
  if (input.userId !== principal.userId) throw new AppError("FORBIDDEN", "Photo belongs to its original photographer.");
  if (principal.authMethod === "WAREHOUSE_PIN" && input.deviceId !== principal.deviceId) throw new AppError("FORBIDDEN", "Photo device differs from the authenticated device.");
  if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES) throw new AppError("VALIDATION_ERROR", "Photo exceeds size limit.", { mediaReason: "FILE_TOO_LARGE" });
  const rawSha256 = digest(bytes), payload = { ...input, rawSha256 }, requestHash = sha256Hex(JSON.stringify(payload));
  return executeIdempotent(db, { scope: "media:upload", idempotencyKey: input.idempotencyKey, payload }, (tx) =>
    withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
      const receipt = await mediaReceipt(ctx.tx, input.idempotencyKey, principal.userId, requestHash, "UPLOAD");
      if (receipt) return { status: 201, body: receipt };
      const target = await resolveUploadTarget(ctx.tx, principal, input);
      const photo = await inspectPhoto(bytes, config);
      const id = input.idempotencyKey, extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[photo.mime]!;
      const key = privateImageKey(id, `original.${extension}`);
      let versionId: string | undefined;
      try { versionId = (await storage.putPrivate(key, bytes, photo.mime)).versionId; }
      catch (error) {
        if (!(error instanceof StorageExistsError)) throw error;
        // Recover an immutable orphan from an earlier transaction failure; never overwrite it.
        await storage.readPrivate(key, rawSha256);
      }
      await ctx.tx.insert(productImages).values({ id, ...target, slot: input.slot,
        role: input.slot === "MAIN" ? "MAIN" : input.slot === "IDENTIFICATION" ? "IDENTITY" : "GALLERY",
        usage: input.slot === "IDENTIFICATION" ? "INTERNAL_EVIDENCE" : "PUBLIC",
        rawStorageKey: key, rawSha256, rawBytes: bytes.byteLength, rawVersionId: versionId,
        mimeType: photo.mime, width: photo.width, height: photo.height, capturedAt: new Date(input.capturedAt),
        deviceId: input.deviceId, registeredDeviceId: principal.deviceId, idempotencyKey: input.idempotencyKey,
        requestHash, tier1QualityJson: photo.quality, createdBy: principal.userId });
      const jobId = await queueMediaJob(ctx, "process-image", { imageId: id, imageVersion: 1 }, `process-image:${id}:1`);
      if (target.intakeId) await refreshIntakePhotoStatus(ctx, target.intakeId);
      const body = { id, ...target, slot: input.slot, rawSha256, rawBytes: bytes.byteLength };
      await ctx.recordAudit({ action: "IMAGE_UPLOADED", entityType: "product_image", entityId: id, after: { ...body, jobId, submittedIntakeId: input.intakeId, submittedIntakeKey: input.intakeIdempotencyKey } });
      await ctx.emitOutboxEvent({ eventType: "IMAGE_UPLOADED", aggregateType: "product_image", aggregateId: id, payload: body, consumers: [] });
      await recordMediaReceipt(ctx, input.idempotencyKey, requestHash, "UPLOAD", body);
      return { status: 201, body };
    })
  );
}

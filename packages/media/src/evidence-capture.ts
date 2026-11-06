import { type DbExecutor, productImages } from "@khidi/db";
import { createDomainTransactionContext } from "@khidi/domain";
import { sha256Hex } from "@khidi/shared";
import { inspectPhoto } from "./upload.ts";
import { putRetained } from "./processing.ts";
import { privateImageKey, type MediaStorage } from "./storage.ts";
import { queueMediaJob } from "./transactions.ts";

/** Captured evidence uses the existing immutable media and metadata-stripping pipeline. */
export async function storeEvidencePhoto(
  tx: DbExecutor, storage: MediaStorage, input: {
    id: string; skuId: string; userId: string; deviceId?: string; privateDocument: boolean;
  }, bytes: Uint8Array
) {
  const photo = await inspectPhoto(bytes);
  const suffix = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[photo.mime];
  const filename = `original.${suffix}`;
  if (input.privateDocument) {
    const stored = await putRetained(storage, `evidence/${input.id}/${filename}`, bytes, photo.mime);
    return { attachment: { key: stored.key, sha256: stored.sha256, mimeType: stored.contentType } };
  }
  const raw = await putRetained(storage, privateImageKey(input.id, filename), bytes, photo.mime);
  await tx.insert(productImages).values({
    id: input.id, skuId: input.skuId, slot: "IDENTIFICATION", role: "IDENTITY", usage: "INTERNAL_EVIDENCE",
    rawStorageKey: raw.key, rawSha256: raw.sha256, rawBytes: raw.bytes, rawVersionId: raw.versionId, mimeType: photo.mime,
    width: photo.width, height: photo.height, capturedAt: new Date(), deviceId: input.deviceId ?? input.id,
    registeredDeviceId: input.deviceId, idempotencyKey: input.id,
    requestHash: sha256Hex(JSON.stringify([input.skuId, input.userId, raw.sha256])), tier1QualityJson: { passed: true, server: photo.quality },
    createdBy: input.userId
  });
  const ctx = createDomainTransactionContext(tx, { userId: input.userId });
  await queueMediaJob(ctx, "process-image", { imageId: input.id, imageVersion: 1 }, `process-image:${input.id}:1`);
  await ctx.recordAudit({ action: "IMAGE_UPLOADED", entityType: "product_image", entityId: input.id, after: { skuId: input.skuId, evidence: true } });
  await ctx.emitOutboxEvent({ eventType: "IMAGE_UPLOADED", aggregateType: "product_image", aggregateId: input.id, payload: { skuId: input.skuId }, consumers: [] });
  return { imageId: input.id };
}

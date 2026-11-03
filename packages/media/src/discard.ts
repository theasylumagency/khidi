import { eq } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, intakePhotoStatus, productImages, productIntakes } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError, sha256Hex } from "@khidi/shared";
import { photoDiscardSchema } from "./contracts.ts";
import { getPhotoCaptureContext } from "./capture.ts";
import { initializeIntakePhotos, intakeSku } from "./targets.ts";
import { mediaReceipt, recordMediaReceipt } from "./transactions.ts";

export async function reportOfflinePhotoDiscard(db: DbExecutor, principal: AuthenticatedPrincipal, raw: unknown) {
  const parsed = photoDiscardSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid photo discard metadata.");
  const input = parsed.data;
  if (input.userId !== principal.userId || principal.authMethod === "WAREHOUSE_PIN" && input.deviceId !== principal.deviceId) throw new AppError("FORBIDDEN", "Photo discard owner/device mismatch.");
  const hash = sha256Hex(JSON.stringify(input));
  return executeIdempotent(db, { scope: "media:discard", idempotencyKey: input.idempotencyKey, payload: input }, (tx) => withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
    const receipt = await mediaReceipt(ctx.tx, input.idempotencyKey, principal.userId, hash, "PHOTO_DISCARD");
    if (receipt) return { status: 200, body: receipt };
    const { intakeId, intakeIdempotencyKey, photoRequestTaskId, skuId } = input;
    const target = await getPhotoCaptureContext(ctx.tx, principal, { intakeId, intakeIdempotencyKey, photoRequestTaskId, skuId });
    const [image] = await ctx.tx.select({ owner: productImages.createdBy }).from(productImages).where(eq(productImages.id, input.photo.idempotencyKey)).limit(1);
    if (image && image.owner !== principal.userId) throw new AppError("FORBIDDEN", "Only the photo owner can discard it.");
    if (target.originalIntakeId) {
      const [intake] = await ctx.tx.select().from(productIntakes).where(eq(productIntakes.id, target.originalIntakeId)).for("update");
      await initializeIntakePhotos(ctx, intake!.id, intakeSku(intake!));
      await ctx.tx.update(intakePhotoStatus).set({ status: "ATTENTION", attentionReason: input.reason, updatedAt: new Date() }).where(eq(intakePhotoStatus.intakeId, intake!.id));
      await ctx.tx.update(productIntakes).set({ photosMissing: true, photoAttentionReason: input.reason }).where(eq(productIntakes.id, intake!.id));
    }
    const body = { id: input.idempotencyKey, intakeId: target.originalIntakeId, needsAttention: true };
    await ctx.recordAudit({ action: "OFFLINE_PHOTO_DISCARDED", entityType: "offline_photo", entityId: input.idempotencyKey, after: { ...input, originalIntakeId: target.originalIntakeId }, reason: input.reason });
    await ctx.emitOutboxEvent({ eventType: "OFFLINE_PHOTO_DISCARDED", aggregateType: "offline_photo", aggregateId: input.idempotencyKey, payload: { ...input, originalIntakeId: target.originalIntakeId }, consumers: ["notifications"] });
    await recordMediaReceipt(ctx, input.idempotencyKey, hash, "PHOTO_DISCARD", body);
    return { status: 200, body };
  }));
}

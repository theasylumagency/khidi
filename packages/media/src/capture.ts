import { eq } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, intakePhotoStatus, productImages, productIntakes, scanTasks, skus } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError, sha256Hex } from "@khidi/shared";
import { type CaptureSlot, type PhotoSlot, photoAttentionSchema, photoTargetSchema } from "./contracts.ts";
import { assertMediaPrincipal } from "./principal.ts";
import { canCompleteIntakePhotos, captureSlotsForSku, initializeIntakePhotos, intakeSku, originalPhotoIntake, resolveUploadTarget } from "./targets.ts";
import { configuredQuality } from "./upload.ts";
import { mediaReceipt, recordMediaReceipt } from "./transactions.ts";

export async function getPhotoCaptureContext(db: DbExecutor, principal: AuthenticatedPrincipal, raw: unknown) {
  await assertMediaPrincipal(db, principal);
  const parsed = photoTargetSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid photo target.");
  const target = parsed.data;
  let skuId: string | null = null, intakeId: string | null = null, taskId: string | null = null;
  let required: string[] | null = null, photosRequired = false, title: string | null = null;
  let isDuplicate = false, covered: string[] = [], canComplete = true;
  if (target.intakeId || target.intakeIdempotencyKey) {
    const [requested] = await db.select().from(productIntakes).where(target.intakeId ? eq(productIntakes.id, target.intakeId) : eq(productIntakes.idempotencyKey, target.intakeIdempotencyKey!)).limit(1);
    if (!requested) throw new AppError("PRECONDITION_FAILED", "Intake delivery pending.", { mediaReason: "DEPENDENCY_PENDING" });
    const intake = await originalPhotoIntake(db, requested);
    isDuplicate = requested.id !== intake.id; canComplete = await canCompleteIntakePhotos(db, principal, intake);
    if (!canComplete && requested.scannedBy !== principal.userId) throw new AppError("FORBIDDEN", "Only the scanner or assigned task member may view capture status.");
    intakeId = intake.id; skuId = intakeSku(intake);
    const [state] = await db.select().from(intakePhotoStatus).where(eq(intakePhotoStatus.intakeId, intake.id)).limit(1);
    required = state?.requiredSlotsJson ?? null; covered = state?.coveredSlotsJson ?? []; photosRequired = !!state;
    if (intake.taskId) {
      const [task] = await db.select({ title: scanTasks.title, photosRequired: scanTasks.photosRequired }).from(scanTasks).where(eq(scanTasks.id, intake.taskId)).limit(1);
      title = task?.title ?? null; photosRequired ||= task?.photosRequired ?? false;
    }
  } else if (target.photoRequestTaskId) {
    const [task] = await db.select().from(scanTasks).where(eq(scanTasks.id, target.photoRequestTaskId)).limit(1);
    if (!task || task.taskType !== "PHOTO_REQUEST" || !task.targetSkuId) throw new AppError("NOT_FOUND", "Photo task not found.");
    if (principal.role !== "ADMIN" && (principal.role !== "WAREHOUSE" || task.assigneeUserId !== principal.userId && task.assigneeRole !== principal.role)) throw new AppError("FORBIDDEN", "Photo request not assigned.");
    skuId = task.targetSkuId; taskId = task.id; required = task.requestedPhotoSlotsJson; title = task.title; photosRequired = true;
    canComplete = ["OPEN", "IN_PROGRESS"].includes(task.status);
  } else {
    if (principal.role !== "ADMIN") throw new AppError("FORBIDDEN", "SKU media administration requires admin.");
    const [sku] = await db.select({ id: skus.id }).from(skus).where(eq(skus.id, target.skuId!)).limit(1);
    if (!sku) throw new AppError("NOT_FOUND", "SKU not found.");
    skuId = sku.id;
  }
  let slots = await captureSlotsForSku(db, skuId);
  if (required) {
    slots = slots.filter((slot) => !taskId || required!.includes(slot.slot)).map((slot) => ({ ...slot, required: required!.includes(slot.slot), alreadyCovered: covered.includes(slot.slot) }));
    for (const slot of required) if (!slots.some((known) => known.slot === slot)) slots.push({ slot: slot as PhotoSlot, required: true });
  }
  const images = await db.select({ id: productImages.id, slot: productImages.slot, status: productImages.status, passedTier1: productImages.tier1QualityJson })
    .from(productImages).where(intakeId ? eq(productImages.intakeId, intakeId) : taskId ? eq(productImages.photoRequestTaskId, taskId) : eq(productImages.skuId, skuId!));
  const acceptedSlots = [...new Set(images.filter((image) => image.passedTier1.passed === true && image.status !== "REJECTED").map((image) => image.slot as PhotoSlot))];
  return { target: intakeId ? { intakeId, intakeIdempotencyKey: null, photoRequestTaskId: null, skuId: null } : target,
    originalIntakeId: intakeId, isDuplicate, canCompletePhotos: canComplete, title, slots: slots as CaptureSlot[], photosRequired,
    missingSlots: slots.filter((slot) => slot.required && !acceptedSlots.includes(slot.slot)).map((slot) => slot.slot), acceptedSlots, qualityConfig: configuredQuality() };
}

export async function reportPhotoAttention(db: DbExecutor, principal: AuthenticatedPrincipal, raw: unknown) {
  await assertMediaPrincipal(db, principal);
  const parsed = photoAttentionSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "A photo reason is required.");
  const input = parsed.data;
  if (input.userId !== principal.userId || principal.authMethod === "WAREHOUSE_PIN" && input.deviceId !== principal.deviceId) throw new AppError("FORBIDDEN", "Photo report owner/device mismatch.");
  const hash = sha256Hex(JSON.stringify(input));
  return executeIdempotent(db, { scope: "media:attention", idempotencyKey: input.idempotencyKey, payload: input }, (tx) => withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
    const receipt = await mediaReceipt(ctx.tx, input.idempotencyKey, principal.userId, hash, "PHOTO_ATTENTION");
    if (receipt) return { status: 201, body: receipt };
    const target = await resolveUploadTarget(ctx.tx, principal, { ...input, slot: input.slots[0]! });
    if (target.intakeId) {
      await initializeIntakePhotos(ctx, target.intakeId, target.skuId);
      await ctx.tx.update(intakePhotoStatus).set({ status: "ATTENTION", attentionReason: input.reason, updatedAt: new Date() }).where(eq(intakePhotoStatus.intakeId, target.intakeId));
      await ctx.tx.update(productIntakes).set({ photosMissing: true, photoAttentionReason: input.reason }).where(eq(productIntakes.id, target.intakeId));
    }
    const body = { id: input.idempotencyKey, ...target, needsAttention: true, slots: input.slots, reason: input.reason, capturedAt: input.capturedAt };
    await ctx.recordAudit({ action: "PHOTO_ATTENTION_REPORTED", entityType: "photo_attention", entityId: input.idempotencyKey, after: body, reason: input.reason });
    await ctx.emitOutboxEvent({ eventType: "PHOTO_ATTENTION_REPORTED", aggregateType: "photo_attention", aggregateId: input.idempotencyKey, payload: body, consumers: ["notifications"] });
    await recordMediaReceipt(ctx, input.idempotencyKey, hash, "PHOTO_ATTENTION", body);
    return { status: 201, body };
  }));
}

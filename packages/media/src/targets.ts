import { and, asc, eq, isNull } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, intakePhotoStatus, productImages, productIntakes, productTypes, scanTasks, skus } from "@khidi/db";
import type { DomainTransactionContext } from "@khidi/domain";
import { AppError } from "@khidi/shared";
import { GENERIC_CAPTURE_SLOTS, PHOTO_SLOTS, type CaptureSlot, type PhotoSlot, type PhotoUploadInput } from "./contracts.ts";
import { queueMediaJob } from "./transactions.ts";

export function intakeSku(intake: typeof productIntakes.$inferSelect) {
  return !intake.reviewOriginalReason || ["LINK_EXISTING", "ACCEPT_FOR_TASK"].includes(intake.reviewResolution ?? "") ? intake.matchedSkuId : null;
}
export async function captureSlotsForSku(db: DbExecutor, skuId: string | null): Promise<CaptureSlot[]> {
  if (!skuId) return structuredClone(GENERIC_CAPTURE_SLOTS);
  const [row] = await db.select({ slots: productTypes.photoInstructionsJson }).from(skus)
    .leftJoin(productTypes, eq(productTypes.id, skus.productTypeId)).where(eq(skus.id, skuId)).limit(1);
  const slots = row?.slots?.filter((slot) => PHOTO_SLOTS.includes(slot.slot));
  return slots?.length ? slots.map(({ slot, required, titleKa, guidanceKa }) => ({ slot, required, titleKa, guidanceKa })) : structuredClone(GENERIC_CAPTURE_SLOTS);
}
export async function initializeIntakePhotos(ctx: DomainTransactionContext, intakeId: string, skuId: string | null) {
  const slots = await captureSlotsForSku(ctx.tx, skuId);
  await ctx.tx.insert(intakePhotoStatus).values({ intakeId, requiredSlotsJson: slots.filter((slot) => slot.required).map((slot) => slot.slot) }).onConflictDoNothing();
  await ctx.tx.update(productIntakes).set({ photosMissing: true }).where(eq(productIntakes.id, intakeId));
}
export async function resolveUploadTarget(tx: DbExecutor, principal: AuthenticatedPrincipal, input: PhotoUploadInput) {
  if (input.photoRequestTaskId) {
    if (principal.role !== "ADMIN" && principal.role !== "WAREHOUSE") throw new AppError("FORBIDDEN", "Photo requests are warehouse work.");
    const [task] = await tx.select().from(scanTasks).where(eq(scanTasks.id, input.photoRequestTaskId)).for("update");
    if (!task || task.taskType !== "PHOTO_REQUEST" || !task.targetSkuId) throw new AppError("NOT_FOUND", "Photo request not found.");
    if (principal.role !== "ADMIN" && task.assigneeUserId !== principal.userId && task.assigneeRole !== principal.role) throw new AppError("FORBIDDEN", "Photo request not assigned.");
    if (!["OPEN", "IN_PROGRESS"].includes(task.status)) throw new AppError("PRECONDITION_FAILED", "Photo request closed.", { mediaReason: "TARGET_UNAVAILABLE" });
    if (!task.requestedPhotoSlotsJson?.includes(input.slot)) throw new AppError("VALIDATION_ERROR", "Slot not requested.");
    if (input.skuId && input.skuId !== task.targetSkuId) throw new AppError("VALIDATION_ERROR", "Wrong photo request SKU.");
    return { skuId: task.targetSkuId, intakeId: null, photoRequestTaskId: task.id };
  }
  if (input.intakeId || input.intakeIdempotencyKey) {
    const predicate = input.intakeId ? eq(productIntakes.id, input.intakeId) : eq(productIntakes.idempotencyKey, input.intakeIdempotencyKey!);
    const [intake] = await tx.select().from(productIntakes).where(predicate).for("update");
    if (!intake) throw new AppError("PRECONDITION_FAILED", "Intake has not been delivered.", { mediaReason: "DEPENDENCY_PENDING" });
    if (principal.role !== "ADMIN" && intake.scannedBy !== principal.userId) throw new AppError("FORBIDDEN", "Photo belongs to the intake scanner.");
    const skuId = intakeSku(intake);
    if (input.skuId && input.skuId !== skuId) throw new AppError("VALIDATION_ERROR", "Review photos await explicit SKU resolution.");
    return { skuId, intakeId: intake.id, photoRequestTaskId: null };
  }
  if (principal.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only administrators upload directly to a SKU.");
  const [sku] = await tx.select({ id: skus.id }).from(skus).where(eq(skus.id, input.skuId!)).limit(1);
  if (!sku) throw new AppError("NOT_FOUND", "SKU not found.");
  return { skuId: sku.id, intakeId: null, photoRequestTaskId: null };
}
export async function refreshIntakePhotoStatus(ctx: DomainTransactionContext, intakeId: string) {
  const [state] = await ctx.tx.select().from(intakePhotoStatus).where(eq(intakePhotoStatus.intakeId, intakeId)).for("update");
  if (!state) return;
  const images = await ctx.tx.select({ slot: productImages.slot, tier1: productImages.tier1QualityJson, status: productImages.status }).from(productImages).where(eq(productImages.intakeId, intakeId));
  const accepted = new Set(images.filter((image) => image.tier1.passed === true && image.status !== "REJECTED").map((image) => image.slot));
  const complete = state.requiredSlotsJson.every((slot) => accepted.has(slot));
  await ctx.tx.update(intakePhotoStatus).set({ status: complete ? "COMPLETE" : state.status === "ATTENTION" ? "ATTENTION" : "PENDING", attentionReason: complete ? null : state.attentionReason, updatedAt: new Date() }).where(eq(intakePhotoStatus.intakeId, intakeId));
  await ctx.tx.update(productIntakes).set({ photosMissing: !complete, photoAttentionReason: complete ? null : state.attentionReason }).where(eq(productIntakes.id, intakeId));
}
/** Called inside the admin review transaction, never by scan identity matching. */
export async function linkIntakeImagesToSku(ctx: DomainTransactionContext, intakeId: string, skuId: string) {
  const linked = await ctx.tx.update(productImages).set({ skuId, updatedAt: new Date() }).where(and(eq(productImages.intakeId, intakeId), isNull(productImages.skuId))).returning({ id: productImages.id, version: productImages.masterVersion });
  if (!linked.length) return;
  for (const image of linked) if (image.version) await queueMediaJob(ctx, "tier2-image-check", { imageId: image.id, imageVersion: image.version }, `tier2-linked:${image.id}:${image.version}:${skuId}`);
  await queueMediaJob(ctx, "publish-sku-media", { skuId });
  await ctx.recordAudit({ action: "INTAKE_IMAGES_LINKED", entityType: "product_intake", entityId: intakeId, after: { skuId, imageIds: linked.map((image) => image.id) } });
  await ctx.emitOutboxEvent({ eventType: "INTAKE_IMAGES_LINKED", aggregateType: "product_intake", aggregateId: intakeId, payload: { skuId, imageIds: linked.map((image) => image.id) }, consumers: [] });
}

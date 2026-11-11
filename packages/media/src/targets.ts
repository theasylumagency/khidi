import { and, desc,eq, isNull, or } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, getSkuImages, identificationObservations,intakePhotoStatus, productImages, productIntakes, productTypes, scanTasks, skus } from "@khidi/db";
import type { DomainTransactionContext } from "@khidi/domain";
import { AppError } from "@khidi/shared";
import { GENERIC_CAPTURE_SLOTS, PHOTO_SLOTS, type CaptureSlot, type PhotoSlot, type PhotoUploadInput } from "./contracts.ts";
import { queueMediaJob } from "./transactions.ts";

export function intakeSku(intake: typeof productIntakes.$inferSelect) {
  return !intake.reviewOriginalReason || ["LINK_EXISTING", "ACCEPT_FOR_TASK"].includes(intake.reviewResolution ?? "") ? intake.matchedSkuId : null;
}
export async function originalPhotoIntake(db: DbExecutor, intake: typeof productIntakes.$inferSelect, lock = false) {
  if (!intake.duplicateOfIntakeId) return intake;
  const query = db.select().from(productIntakes).where(eq(productIntakes.id, intake.duplicateOfIntakeId));
  const [original] = lock ? await query.for("update") : await query.limit(1);
  if (!original || original.duplicateOfIntakeId) throw new AppError("INVARIANT_VIOLATION", "Original intake reference is invalid.");
  return original;
}
export async function canCompleteIntakePhotos(db: DbExecutor, principal: AuthenticatedPrincipal, intake: typeof productIntakes.$inferSelect) {
  if (principal.role === "ADMIN" || intake.scannedBy === principal.userId) return true;
  if (!intake.taskId) return false;
  const [task] = await db.select().from(scanTasks).where(eq(scanTasks.id, intake.taskId)).limit(1);
  return !!task && task.taskType === "INTAKE_UNIQUE" && (task.assigneeUserId === principal.userId || task.assigneeRole === principal.role);
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
  const verified = skuId ? (await getSkuImages(ctx.tx,skuId)).filter((image)=>image.status==="VERIFIED") : [];
  const covered = [...new Set(verified.map((image) => image.slot))];
  const required = slots.filter((slot) => slot.required && !covered.includes(slot.slot)).map((slot) => slot.slot);
  await ctx.tx.insert(intakePhotoStatus).values({ intakeId, requiredSlotsJson: required, coveredSlotsJson: covered, status: required.length ? "PENDING" : "COMPLETE" }).onConflictDoNothing();
  await ctx.tx.update(productIntakes).set({ photosMissing: required.length > 0 }).where(eq(productIntakes.id, intakeId));
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
    const [requested] = await tx.select().from(productIntakes).where(predicate).for("update");
    if (!requested) throw new AppError("PRECONDITION_FAILED", "Intake has not been delivered.", { mediaReason: "DEPENDENCY_PENDING" });
    const intake = await originalPhotoIntake(tx, requested, true);
    if (requested.scannedBy !== principal.userId && !await canCompleteIntakePhotos(tx, principal, intake)) throw new AppError("FORBIDDEN", "Photo belongs to the scanner or an assigned task member.");
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
  const images = await ctx.tx.select({ slot: productImages.slot, tier1: productImages.tier1QualityJson, status: productImages.status }).from(productImages).where(eq(productImages.intakeId, intakeId));
  const disagreement = images.some((image) => image.status === "UNVERIFIED" && image.tier1.disagreement === true);
  if (!state) {
    await ctx.tx.update(productIntakes).set({ photoAttentionReason: disagreement ? "SERVER_TIER1_DISAGREEMENT" : null })
      .where(and(eq(productIntakes.id, intakeId), or(isNull(productIntakes.photoAttentionReason), eq(productIntakes.photoAttentionReason, "SERVER_TIER1_DISAGREEMENT"))));
    return;
  }
  const accepted = new Set(images.filter((image) => image.tier1.passed === true && image.status !== "REJECTED").map((image) => image.slot));
  const observations=await ctx.tx.select().from(identificationObservations).where(eq(identificationObservations.intakeId,intakeId)).orderBy(desc(identificationObservations.createdAt),desc(identificationObservations.id));
  const unresolved=observations.filter((row,index,all)=>all.findIndex(other=>other.slot===row.slot)===index&&!accepted.has(row.slot));
  const engine=observations.find(row=>row.slot==="ENGINE_IDENTIFICATION");
  if(engine?.outcome==="PLATE_ABSENT")accepted.add("ENGINE_IDENTIFICATION");
  const complete = state.requiredSlotsJson.every((slot) => accepted.has(slot));
  const attentionReason = disagreement ? "SERVER_TIER1_DISAGREEMENT" : unresolved[0]?.reason??(complete||["PLATE_ABSENT","CAPTURE_PENDING"].includes(state.attentionReason??"") ? null : state.attentionReason);
  await ctx.tx.update(intakePhotoStatus).set({ status: attentionReason ? "ATTENTION" : complete ? "COMPLETE" : "PENDING", attentionReason, updatedAt: new Date() }).where(eq(intakePhotoStatus.intakeId, intakeId));
  await ctx.tx.update(productIntakes).set({ photosMissing: !complete, photoAttentionReason: attentionReason }).where(eq(productIntakes.id, intakeId));
}
export async function refreshPhotoRequest(ctx: DomainTransactionContext, taskId: string) {
  const [task] = await ctx.tx.select().from(scanTasks).where(eq(scanTasks.id, taskId)).for("update");
  if (!task || task.taskType !== "PHOTO_REQUEST" || !["OPEN", "IN_PROGRESS"].includes(task.status)) return;
  const images = await ctx.tx.select({ slot: productImages.slot, quality: productImages.tier1QualityJson, status: productImages.status }).from(productImages).where(eq(productImages.photoRequestTaskId, taskId));
  const accepted = new Set(images.filter((image) => image.quality.passed === true && image.status !== "REJECTED").map((image) => image.slot));
  const observations=await ctx.tx.select().from(identificationObservations).where(eq(identificationObservations.photoRequestTaskId,taskId)).orderBy(desc(identificationObservations.createdAt),desc(identificationObservations.id));
  const engine=observations.find(row=>row.slot==="ENGINE_IDENTIFICATION"),resolvedObservationIds=engine?.outcome==="PLATE_ABSENT"&&!accepted.has("ENGINE_IDENTIFICATION")?[engine.id]:[];
  if(resolvedObservationIds.length)accepted.add("ENGINE_IDENTIFICATION");
  const completedCount = task.requestedPhotoSlotsJson!.filter((slot) => accepted.has(slot)).length, complete = completedCount === task.requestedPhotoSlotsJson!.length;
  await ctx.tx.update(scanTasks).set({ completedCount, status: complete ? "COMPLETED" : "IN_PROGRESS", completedAt: complete ? new Date() : null }).where(eq(scanTasks.id, taskId));
  const body = { status: complete ? "COMPLETED" : "IN_PROGRESS", completedCount, targetCount: task.requestedPhotoSlotsJson!.length,...(resolvedObservationIds.length?{resolvedObservationIds}:{}) };
  await ctx.recordAudit({ action: complete ? "SCAN_TASK_COMPLETED" : "PHOTO_REQUEST_PROGRESS_UPDATED", entityType: "scan_task", entityId: taskId, after: body });
  await ctx.emitOutboxEvent({ eventType: complete ? "SCAN_TASK_COMPLETED" : "PHOTO_REQUEST_PROGRESS_UPDATED", aggregateType: "scan_task", aggregateId: taskId, payload: body, consumers: complete ? ["notifications"] : [] });
}
/** Called inside the admin review transaction, never by scan identity matching. */
export async function linkIntakeImagesToSku(ctx: DomainTransactionContext, intakeId: string, skuId: string) {
  const linked = await ctx.tx.update(productImages).set({ skuId, updatedAt: new Date() }).where(and(eq(productImages.intakeId, intakeId), isNull(productImages.skuId))).returning({ id: productImages.id, version: productImages.masterVersion });
  if (!linked.length) return;
  for (const image of linked) if (image.version) await queueMediaJob(ctx, "tier2-image-check", { imageId: image.id, imageVersion: image.version }, `tier2-linked:${image.id}:${image.version}:${skuId}`);
  await queueMediaJob(ctx, "publish-sku-media", { skuId });
  await ctx.recordAudit({ action: "INTAKE_IMAGES_LINKED", entityType: "product_intake", entityId: intakeId, after: { skuId, imageIds: linked.map((image) => image.id) } });
  await ctx.emitOutboxEvent({ eventType: "INTAKE_IMAGES_LINKED", aggregateType: "product_intake", aggregateId: intakeId, payload: { skuId, imageIds: linked.map((image) => image.id) }, consumers: ["ai-discovery"] });
}

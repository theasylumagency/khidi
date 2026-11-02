import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type AppDatabase, type DbExecutor, labelEvents, productIntakes, scanTasks } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError, createUuidV7, sha256Hex } from "@khidi/shared";
import { intakeInputSchema, type IntakeResult, type ReviewReason } from "./contracts.ts";
import { normalizeScan, resolveScanIdentity } from "./identity.ts";
import { assertScanningPrincipal } from "./principal.ts";
import { initializeIntakePhotos } from "@khidi/media";
export * from "./contracts.ts";
export * from "./identity.ts";
export * from "./labels.ts";
export * from "./tasks.ts";
export * from "./review.ts";
export * from "./discard.ts";

export async function receiveIntake(db: AppDatabase | DbExecutor, principal: AuthenticatedPrincipal, rawInput: unknown) {
  const parsed = intakeInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid intake.", { issues: parsed.error.flatten() });
  const input = parsed.data;
  if (input.userId !== principal.userId) throw new AppError("FORBIDDEN", "An intake belongs to its original scanner.", { blockedReason: "SCAN_OWNER_MISMATCH" });
  if (principal.authMethod === "WAREHOUSE_PIN" && principal.deviceId !== input.deviceId) throw new AppError("FORBIDDEN", "The registered device does not match the session.", { blockedReason: "SCAN_DEVICE_MISMATCH" });
  await assertScanningPrincipal(db, principal);
  if (input.sourceMode === "QUICK_SCAN" && principal.role !== "ADMIN") throw new AppError("FORBIDDEN", "Quick Scan is administrator-only.");
  const requestHash = sha256Hex(JSON.stringify(input));
  return executeIdempotent(db, { scope: "scanning:intake", idempotencyKey: input.idempotencyKey, payload: input }, (tx) =>
    withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
      const [recorded] = await ctx.tx.select().from(productIntakes).where(eq(productIntakes.idempotencyKey, input.idempotencyKey)).limit(1);
      if (recorded) {
        if (recorded.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT", "Intake key already belongs to another request.");
        return { status: 201, body: recorded.acceptanceResponseJson as IntakeResult };
      }
      let task: typeof scanTasks.$inferSelect | undefined;
      let taskReason: ReviewReason | null = null;
      if (input.taskId) {
        [task] = await ctx.tx.select().from(scanTasks).where(eq(scanTasks.id, input.taskId)).for("update");
        if (!task) throw new AppError("NOT_FOUND", "Task not found.");
        if (task.taskType !== "INTAKE_UNIQUE") throw new AppError("PRECONDITION_FAILED", "This task type does not accept M3 intakes.");
        if (!["OPEN", "IN_PROGRESS"].includes(task.status)) taskReason = "TASK_NOT_ACCEPTING";
        else if (principal.role !== "ADMIN" && task.assigneeUserId !== principal.userId && task.assigneeRole !== principal.role) taskReason = "TASK_NOT_ASSIGNED";
      }
      const normalized = input.isNoBarcode ? null : normalizeScan(input.scannedValue, input.identifierType);
      if (normalized) {
        await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`scan:${normalized.key}`}))`);
        await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sku_id_lock:${normalized.canonicalType}:${normalized.canonicalValue}`}))`);
      }
      let identity = await resolveScanIdentity(ctx.tx, ctx.actor, normalized, { allowCreate: false });
      let reviewReason = identity.reviewReason ?? taskReason;
      let first: typeof productIntakes.$inferSelect | undefined;
      if (!reviewReason && task && normalized) {
        [first] = await ctx.tx.select().from(productIntakes).where(and(
          eq(productIntakes.taskId, task.id), eq(productIntakes.normalizedIdentifier, normalized.key),
          isNull(productIntakes.duplicateOfIntakeId), isNull(productIntakes.reviewReason)
        )).orderBy(asc(productIntakes.createdAt)).limit(1);
      }
      if (first) identity = { ...identity, skuId: first.matchedSkuId, resultState: first.resultState as IntakeResult["resultState"] };
      else if (!reviewReason && !identity.skuId) identity = await resolveScanIdentity(ctx.tx, ctx.actor, normalized, { allowCreate: true, productTypeId: task?.productTypeId });
      reviewReason ??= identity.reviewReason;
      if (!reviewReason && normalized?.internal && task && !first && identity.skuId) {
        [first] = await ctx.tx.select().from(productIntakes).where(and(
          eq(productIntakes.taskId, task.id), eq(productIntakes.matchedSkuId, identity.skuId),
          eq(productIntakes.isNoBarcode, true), isNull(productIntakes.reviewReason)
        )).orderBy(asc(productIntakes.createdAt)).limit(1);
      }
      const body: IntakeResult = { id: createUuidV7(), matchedSkuId: identity.skuId, resultState: identity.resultState,
        duplicateOfIntakeId: first?.id ?? null, labelStatus: input.isNoBarcode && !reviewReason ? "TO_PRINT" : "NOT_REQUIRED", reviewReason };
      await ctx.tx.insert(productIntakes).values({
        id: body.id, taskId: input.taskId, sourceMode: input.sourceMode, scannedBy: principal.userId,
        deviceId: principal.deviceId, clientDeviceId: input.deviceId, scannedAt: new Date(input.scannedAt),
        scannedIdentifiersJson: input.isNoBarcode ? [] : [input.scannedValue], normalizedIdentifier: normalized?.key ?? null,
        scannedIdentifierType: normalized?.canonicalType ?? null,
        isNoBarcode: input.isNoBarcode, matchedSkuId: body.matchedSkuId, duplicateOfIntakeId: body.duplicateOfIntakeId,
        labelStatus: body.labelStatus, resultState: body.resultState, idempotencyKey: input.idempotencyKey, requestHash,
        reviewReason, reviewOriginalReason: reviewReason, reviewReferenceSkuId: identity.referenceSkuId, acceptanceResponseJson: body
      });
      if (task?.photosRequired && !first) await initializeIntakePhotos(ctx, body.id, reviewReason ? null : body.matchedSkuId);
      if (body.labelStatus === "TO_PRINT") await ctx.tx.insert(labelEvents).values({
        id: createUuidV7(), intakeId: body.id, fromStatus: null, toStatus: "TO_PRINT", actorUserId: principal.userId
      });
      if (!reviewReason && normalized?.internal && identity.skuId) {
        const awaiting = await ctx.tx.select().from(productIntakes).where(and(
          eq(productIntakes.matchedSkuId, identity.skuId), eq(productIntakes.labelStatus, "PRINTED")
        )).orderBy(asc(productIntakes.id)).for("update");
        for (const original of awaiting) {
          if (principal.role !== "ADMIN" && original.taskId !== input.taskId) continue;
          await ctx.tx.update(productIntakes).set({ labelStatus: "ATTACHED" }).where(eq(productIntakes.id, original.id));
          await ctx.tx.insert(labelEvents).values({ id: createUuidV7(), intakeId: original.id,
            fromStatus: "PRINTED", toStatus: "ATTACHED", actorUserId: principal.userId, scanIntakeId: body.id });
          await ctx.recordAudit({ action: "LABEL_ATTACHED_BY_SCAN", entityType: "product_intake", entityId: original.id, after: { labelStatus: "ATTACHED", scanIntakeId: body.id } });
          await ctx.emitOutboxEvent({ eventType: "LABEL_STATUS_CHANGED", aggregateType: "product_intake", aggregateId: original.id, payload: { labelStatus: "ATTACHED", scanIntakeId: body.id }, consumers: ["notifications"] });
        }
      }
      if (task && !first && !reviewReason) {
        await ctx.tx.update(scanTasks).set({ completedCount: task.completedCount + 1, status: "IN_PROGRESS" }).where(eq(scanTasks.id, task.id));
        await ctx.recordAudit({ action: "SCAN_TASK_PROGRESS_UPDATED", entityType: "scan_task", entityId: task.id, after: { completedCount: task.completedCount + 1 } });
      }
      await ctx.recordAudit({ action: "PRODUCT_INTAKE_RECORDED", entityType: "product_intake", entityId: body.id, after: body });
      await ctx.emitOutboxEvent({ eventType: "PRODUCT_INTAKE_RECORDED", aggregateType: "product_intake", aggregateId: body.id, payload: body, consumers: ["notifications"] });
      return { status: 201, body };
    })
  );
}

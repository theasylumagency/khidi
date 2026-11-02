import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type AppDatabase, type DbExecutor, productIntakes, scanTasks, users } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { attachSkuIdentifier, buildCandidateLookupValues, createSkuDraft, normalizeIdentifierOnWrite, resolveSkuByScannedIdentifier, type SkuIdentifierType } from "@khidi/products";
import { AppError, createUuidV7, sha256Hex } from "@khidi/shared";
import { intakeInputSchema, type IntakeResult } from "./contracts.ts";
export * from "./contracts.ts";

export async function assertScanningPrincipal(db: DbExecutor, principal: AuthenticatedPrincipal, adminOnly = false) {
  const [user] = await db.select().from(users).where(eq(users.id, principal.userId)).limit(1);
  if (!user?.active || user.role !== principal.role) throw new AppError("UNAUTHORIZED", "Session principal is no longer active.");
  if (adminOnly && user.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only an administrator may manage scanning.");
}

export function normalizeScan(value: string, identifierType?: SkuIdentifierType) {
  const internal = /^(?:khidi:\/\/sku\/)?(KH-\d{6,})$/i.exec(value.trim());
  if (internal) {
    const canonicalValue = internal[1]!.toUpperCase();
    return { canonicalValue, canonicalType: "INTERNAL_SKU" as SkuIdentifierType, key: `INTERNAL:${canonicalValue}`, internal: true };
  }
  const lookupValues = buildCandidateLookupValues(value);
  const detectedGtin = lookupValues.find((candidate) => /^\d{14}$/.test(candidate));
  let inferred: SkuIdentifierType = "SUPPLIER_CODE";
  if (detectedGtin) {
    try { normalizeIdentifierOnWrite("GTIN", value); inferred = "GTIN"; } catch { /* numeric supplier code */ }
  }
  const normalized = normalizeIdentifierOnWrite(identifierType ?? inferred, value);
  return { ...normalized, canonicalType: normalized.canonicalType as SkuIdentifierType,
    key: `${normalized.canonicalType === "GTIN" ? "GTIN" : "VALUE"}:${normalized.canonicalValue}`, internal: false };
}

function resultFor(row: typeof productIntakes.$inferSelect): IntakeResult {
  return { id: row.id, matchedSkuId: row.matchedSkuId,
    resultState: row.resultState as IntakeResult["resultState"], duplicateOfIntakeId: row.duplicateOfIntakeId,
    // Original acceptance stays stable after the label is printed/attached.
    labelStatus: row.isNoBarcode ? "TO_PRINT" : "NOT_REQUIRED" };
}

export async function receiveIntake(db: AppDatabase | DbExecutor, principal: AuthenticatedPrincipal, rawInput: unknown) {
  const parsed = intakeInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid intake.", { issues: parsed.error.flatten() });
  const input = parsed.data;
  if (input.userId !== principal.userId) throw new AppError("FORBIDDEN", "An intake belongs to its original scanner.");
  if (principal.authMethod === "WAREHOUSE_PIN" && principal.deviceId !== input.deviceId) throw new AppError("FORBIDDEN", "The registered device does not match the session.");
  await assertScanningPrincipal(db, principal);
  if (input.sourceMode === "QUICK_SCAN" && principal.role !== "ADMIN") throw new AppError("FORBIDDEN", "Quick Scan is administrator-only.");
  const requestHash = sha256Hex(JSON.stringify(input));
  return executeIdempotent(db, { scope: "scanning:intake", idempotencyKey: input.idempotencyKey, payload: input }, (tx) =>
    withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
      // Survives expiration of the generic idempotency cache during long offline periods.
      const [recorded] = await ctx.tx.select().from(productIntakes).where(eq(productIntakes.idempotencyKey, input.idempotencyKey)).limit(1);
      if (recorded) {
        if (recorded.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT", "Intake key already belongs to another request.");
        return { status: 201, body: resultFor(recorded) };
      }
      let task: typeof scanTasks.$inferSelect | undefined;
      if (input.taskId) {
        [task] = await ctx.tx.select().from(scanTasks).where(eq(scanTasks.id, input.taskId)).for("update");
        if (!task) throw new AppError("NOT_FOUND", "Task not found.");
        if (principal.role !== "ADMIN" && task.assigneeUserId !== principal.userId && task.assigneeRole !== principal.role) throw new AppError("FORBIDDEN", "Task is assigned to another user or role.");
        if (task.taskType !== "INTAKE_UNIQUE" || !["OPEN", "IN_PROGRESS"].includes(task.status)) throw new AppError("PRECONDITION_FAILED", "Task does not accept intakes.");
      }
      const normalized = input.isNoBarcode ? null : normalizeScan(input.scannedValue, input.identifierType);
      let first: typeof productIntakes.$inferSelect | undefined;
      if (normalized) {
        await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`scan:${normalized.key}`}))`);
        await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sku_id_lock:${normalized.canonicalType}:${normalized.canonicalValue}`}))`);
        if (task) [first] = await ctx.tx.select().from(productIntakes).where(and(
          eq(productIntakes.taskId, task.id), eq(productIntakes.normalizedIdentifier, normalized.key), isNull(productIntakes.duplicateOfIntakeId)
        )).orderBy(asc(productIntakes.createdAt)).limit(1);
      }
      let skuId = first?.matchedSkuId ?? null;
      let resultState: IntakeResult["resultState"] = (first?.resultState as IntakeResult["resultState"]) ?? "NEW_DRAFT";
      if (!first) {
        const lookup = normalized ? await resolveSkuByScannedIdentifier(ctx.tx, normalized.canonicalValue) : null;
        if (lookup?.isAmbiguousCollision) resultState = "MANUAL_IDENTIFICATION_REQUIRED";
        else if (lookup?.uniqueSkuIds.length === 1) {
          skuId = lookup.uniqueSkuIds[0]!; resultState = "MATCHED_EXISTING";
        } else {
          if (normalized?.internal) throw new AppError("NOT_FOUND", "Unknown or archived internal label.");
          const draft = await createSkuDraft(ctx.tx, ctx.actor, { productTypeId: task?.productTypeId });
          skuId = draft.id;
          if (normalized) await attachSkuIdentifier(ctx.tx, ctx.actor, { skuId,
            identifierType: normalized.canonicalType, value: normalized.canonicalValue, verified: false, issuerSource: "WAREHOUSE_SCAN" });
        }
      }
      const [intake] = await ctx.tx.insert(productIntakes).values({
        id: createUuidV7(), taskId: input.taskId, sourceMode: input.sourceMode, scannedBy: principal.userId,
        deviceId: principal.deviceId, clientDeviceId: input.deviceId, scannedAt: new Date(input.scannedAt),
        scannedIdentifiersJson: input.isNoBarcode ? [] : [input.scannedValue], normalizedIdentifier: normalized?.key ?? null,
        isNoBarcode: input.isNoBarcode, matchedSkuId: skuId, duplicateOfIntakeId: first?.id ?? null,
        labelStatus: input.isNoBarcode ? "TO_PRINT" : "NOT_REQUIRED", resultState, idempotencyKey: input.idempotencyKey, requestHash
      }).returning();
      if (task && !first) {
        await ctx.tx.update(scanTasks).set({ completedCount: task.completedCount + 1, status: "IN_PROGRESS" }).where(eq(scanTasks.id, task.id));
        await ctx.recordAudit({ action: "SCAN_TASK_PROGRESS_UPDATED", entityType: "scan_task", entityId: task.id, after: { completedCount: task.completedCount + 1 } });
      }
      const body = resultFor(intake!);
      await ctx.recordAudit({ action: "PRODUCT_INTAKE_RECORDED", entityType: "product_intake", entityId: body.id, after: body });
      await ctx.emitOutboxEvent({ eventType: "PRODUCT_INTAKE_RECORDED", aggregateType: "product_intake", aggregateId: body.id, payload: body, consumers: ["notifications"] });
      return { status: 201, body };
    })
  );
}

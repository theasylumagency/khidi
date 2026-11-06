import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, intakeReviewActions, labelEvents, productIntakes, scanTasks, skus, users } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { resolveSkuByScannedIdentifier, type SkuIdentifierType } from "@khidi/products";
import { AppError, createUuidV7, sha256Hex, uuidSchema } from "@khidi/shared";
import { reviewResolutionSchema } from "./contracts.ts";
import { normalizeScan, resolveScanIdentity } from "./identity.ts";
import { assertScanningPrincipal } from "./principal.ts";
import { linkIntakeImagesToSku } from "@khidi/media";

export async function getIntakeReview(db: DbExecutor, principal: AuthenticatedPrincipal, intakeId: string) {
  await assertScanningPrincipal(db, principal, true);
  if (!uuidSchema.safeParse(intakeId).success) throw new AppError("VALIDATION_ERROR", "Invalid intake id.");
  const [row] = await db.select({ intake: productIntakes, scanner: users.fullName, taskTitle: scanTasks.title, taskStatus: scanTasks.status })
    .from(productIntakes).innerJoin(users, eq(users.id, productIntakes.scannedBy))
    .leftJoin(scanTasks, eq(scanTasks.id, productIntakes.taskId)).where(eq(productIntakes.id, intakeId)).limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Intake not found.");
  const raw = row.intake.scannedIdentifiersJson[0];
  const matches = raw ? (await resolveSkuByScannedIdentifier(db, normalizeScan(raw).canonicalValue)).matches : [];
  const [referenceSku] = row.intake.reviewReferenceSkuId ? await db.select({ id: skus.id, internalSku: skus.internalSku }).from(skus).where(eq(skus.id, row.intake.reviewReferenceSkuId)).limit(1) : [];
  return { ...row, matches, referenceSku: referenceSku ?? null };
}

export async function resolveIntakeReview(db: DbExecutor, principal: AuthenticatedPrincipal, raw: unknown) {
  await assertScanningPrincipal(db, principal, true);
  const parsed = reviewResolutionSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid review resolution.");
  const input = parsed.data;
  const payload = { ...input, userId: principal.userId };
  const requestHash = sha256Hex(JSON.stringify(payload));
  return executeIdempotent(db, { scope: "scanning:review", idempotencyKey: input.idempotencyKey, payload }, (tx) =>
    withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
      const [receipt] = await ctx.tx.select().from(intakeReviewActions).where(eq(intakeReviewActions.id, input.idempotencyKey)).limit(1);
      if (receipt) {
        if (receipt.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT", "Review key already used.");
        return { status: 200, body: receipt.responseJson };
      }
      const [context] = await ctx.tx.select({ taskId: productIntakes.taskId }).from(productIntakes).where(eq(productIntakes.id, input.intakeId)).limit(1);
      if (!context) throw new AppError("NOT_FOUND", "Intake not found.");
      // Same lock order as receiveIntake: task, identifier, then affected intake rows.
      let task: typeof scanTasks.$inferSelect | undefined;
      if (context.taskId) [task] = await ctx.tx.select().from(scanTasks).where(eq(scanTasks.id, context.taskId)).for("update");
      const [original] = await ctx.tx.select().from(productIntakes).where(eq(productIntakes.id, input.intakeId)).for("update");
      if (!original?.reviewReason || original.reviewedAt) throw new AppError("CONFLICT", "Intake no longer needs review.");
      const before = { reviewReason: original.reviewReason, matchedSkuId: original.matchedSkuId };
      let changes: Partial<typeof productIntakes.$inferInsert> = {
        reviewResolution: input.resolution, reviewNote: input.note, reviewedAt: new Date(), reviewedBy: principal.userId
      };
      let resolved = true;
      if (input.resolution === "LINK_EXISTING") {
        const [target] = await ctx.tx.select().from(skus).where(input.skuId ? eq(skus.id, input.skuId) : eq(skus.internalSku, input.skuCode!)).limit(1);
        if (!target || target.lifecycleState === "ARCHIVED") throw new AppError("PRECONDITION_FAILED", "Choose an active SKU.");
        const lookup = original.scannedIdentifiersJson[0] ? await resolveSkuByScannedIdentifier(ctx.tx, original.scannedIdentifiersJson[0]) : null;
        const replacement = original.isNoBarcode || input.requestReplacementLabel ||
          ["UNKNOWN_INTERNAL_LABEL", "ARCHIVED_INTERNAL_LABEL"].includes(original.reviewReason) || !lookup?.uniqueSkuIds.includes(target.id);
        changes = { ...changes, matchedSkuId: target.id, resultState: "MATCHED_EXISTING",
          replacementLabelRequested: replacement, labelStatus: replacement ? "TO_PRINT" : "NOT_REQUIRED" };
        if (replacement) await ctx.tx.insert(labelEvents).values({ id: createUuidV7(), intakeId: original.id,
          fromStatus: null, toStatus: "TO_PRINT", actorUserId: principal.userId });
      } else if (input.resolution === "ACCEPT_FOR_TASK") {
        if (!["TASK_NOT_ACCEPTING", "TASK_NOT_ASSIGNED"].includes(original.reviewReason) || !task) throw new AppError("PRECONDITION_FAILED", "Only task exceptions can be accepted for a task.");
        if (task.taskType !== "INTAKE_UNIQUE") throw new AppError("PRECONDITION_FAILED", "Unsupported task type.");
        if (!["OPEN", "IN_PROGRESS"].includes(task.status) && !input.reopenTask) throw new AppError("PRECONDITION_FAILED", "Reopen the task before accepting this intake.");
        const normalized = original.isNoBarcode ? null : normalizeScan(original.scannedIdentifiersJson[0]!, original.scannedIdentifierType as SkuIdentifierType | undefined);
        if (normalized) {
          await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`scan:${normalized.key}`}))`);
          await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sku_id_lock:${normalized.canonicalType}:${normalized.canonicalValue}`}))`);
        }
        let identity = await resolveScanIdentity(ctx.tx, ctx.actor, normalized, { allowCreate: false });
        if (identity.reviewReason) {
          // A new collision/archived identity stays unresolved and changes no catalog data.
          changes = { reviewReason: identity.reviewReason, reviewReferenceSkuId: identity.referenceSkuId,
            resultState: "MANUAL_IDENTIFICATION_REQUIRED", matchedSkuId: null };
          resolved = false;
        } else {
          let first: typeof productIntakes.$inferSelect | undefined;
          if (normalized) [first] = await ctx.tx.select().from(productIntakes).where(and(
            eq(productIntakes.taskId, task.id), eq(productIntakes.normalizedIdentifier, normalized.key),
            isNull(productIntakes.duplicateOfIntakeId), isNull(productIntakes.reviewReason)
          )).orderBy(asc(productIntakes.createdAt)).limit(1);
          if (!identity.skuId && !first) identity = await resolveScanIdentity(ctx.tx, ctx.actor, normalized, { allowCreate: true, productTypeId: task.productTypeId });
          if (identity.reviewReason) throw new AppError("CONFLICT", "Identity changed during review; retry the resolution.");
          changes = { ...changes, reviewReason: null,
            matchedSkuId: normalized?.internal ? identity.skuId : first?.matchedSkuId ?? identity.skuId,
            resultState: first?.resultState ?? identity.resultState, duplicateOfIntakeId: first?.id ?? null,
            labelStatus: original.isNoBarcode ? "TO_PRINT" : "NOT_REQUIRED" };
          if (original.isNoBarcode) await ctx.tx.insert(labelEvents).values({ id: createUuidV7(), intakeId: original.id,
            fromStatus: null, toStatus: "TO_PRINT", actorUserId: principal.userId });
          await ctx.tx.update(scanTasks).set({ completedCount: task.completedCount + (first ? 0 : 1), status: "IN_PROGRESS", completedAt: null }).where(eq(scanTasks.id, task.id));
          await ctx.recordAudit({ action: input.reopenTask && !["OPEN", "IN_PROGRESS"].includes(task.status) ? "SCAN_TASK_REOPENED_FOR_REVIEW" : "SCAN_TASK_PROGRESS_UPDATED",
            entityType: "scan_task", entityId: task.id, before: { status: task.status, completedCount: task.completedCount },
            after: { status: "IN_PROGRESS", completedCount: task.completedCount + (first ? 0 : 1) }, reason: input.note });
        }
      }
      const [updated] = await ctx.tx.update(productIntakes).set(changes).where(eq(productIntakes.id, original.id)).returning();
      if (resolved && updated!.matchedSkuId && input.resolution !== "DISMISS") await linkIntakeImagesToSku(ctx, original.id, updated!.matchedSkuId);
      const body = { id: original.id, resolved, resolution: updated!.reviewResolution, reviewReason: updated!.reviewReason,
        matchedSkuId: updated!.matchedSkuId, labelStatus: updated!.labelStatus };
      await ctx.recordAudit({ action: resolved ? "INTAKE_REVIEW_RESOLVED" : "INTAKE_REVIEW_STILL_REQUIRED", entityType: "product_intake", entityId: original.id,
        before, after: body, reason: input.note });
      await ctx.emitOutboxEvent({ eventType: "INTAKE_REVIEW_RESOLVED", aggregateType: "product_intake", aggregateId: original.id, payload: body, consumers: [] });
      await ctx.tx.insert(intakeReviewActions).values({ id: input.idempotencyKey, intakeId: original.id, actorUserId: principal.userId, requestHash, responseJson: body });
      return { status: 200, body };
    })
  );
}

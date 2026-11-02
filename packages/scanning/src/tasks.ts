import { and, desc, eq } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, productIntakes, productTypes, scanTasks, skus, users } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError, createUuidV7 } from "@khidi/shared";
import { createScanTaskSchema, intakeFiltersSchema } from "./contracts.ts";
import { assertScanningPrincipal } from "./principal.ts";

export async function createScanTask(db: DbExecutor, principal: AuthenticatedPrincipal, raw: unknown) {
  await assertScanningPrincipal(db, principal, true);
  const parsed = createScanTaskSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid task.");
  const input = parsed.data;
  if (input.taskType !== "INTAKE_UNIQUE") {
    const milestone = { PHYSICAL_COUNT: 8, PHOTO_REQUEST: 4, EVIDENCE_REQUEST: 5, PICK: 9 }[input.taskType];
    throw new AppError("PRECONDITION_FAILED", `Task type is available from milestone ${milestone}.`, { milestone });
  }
  return executeIdempotent(db, { scope: "scanning:tasks:create", idempotencyKey: input.idempotencyKey, payload: { ...input, userId: principal.userId } }, (tx) =>
    withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
      if (input.assigneeUserId) {
        const [user] = await ctx.tx.select({ active: users.active }).from(users).where(eq(users.id, input.assigneeUserId)).limit(1);
        if (!user?.active) throw new AppError("NOT_FOUND", "Active assignee not found.");
      }
      if (input.productTypeId) {
        const [type] = await ctx.tx.select({ active: productTypes.active }).from(productTypes).where(eq(productTypes.id, input.productTypeId)).limit(1);
        if (!type?.active) throw new AppError("NOT_FOUND", "Active Product Type not found.");
      }
      const id = createUuidV7();
      await ctx.tx.insert(scanTasks).values({ id, taskType: input.taskType, title: input.title,
        assigneeUserId: input.assigneeUserId, assigneeRole: input.assigneeRole, productTypeId: input.productTypeId,
        targetCount: input.targetCount, dueDate: input.dueDate ? new Date(input.dueDate) : null, createdBy: principal.userId });
      const body = { id };
      await ctx.recordAudit({ action: "SCAN_TASK_CREATED", entityType: "scan_task", entityId: id, after: { ...input, idempotencyKey: undefined } });
      await ctx.emitOutboxEvent({ eventType: "SCAN_TASK_CREATED", aggregateType: "scan_task", aggregateId: id, payload: { id, taskType: input.taskType }, consumers: ["notifications"] });
      return { status: 201, body };
    })
  );
}

export async function listScanTasks(db: DbExecutor, principal: AuthenticatedPrincipal, page = 1) {
  await assertScanningPrincipal(db, principal, true);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new AppError("VALIDATION_ERROR", "Invalid page.");
  const rows = await db.select().from(scanTasks).orderBy(desc(scanTasks.createdAt), desc(scanTasks.id)).limit(101).offset((page - 1) * 100);
  return { rows: rows.slice(0, 100), hasMore: rows.length > 100 };
}

export async function listTaskAssignees(db: DbExecutor, principal: AuthenticatedPrincipal) {
  await assertScanningPrincipal(db, principal, true);
  return db.select({ id: users.id, fullName: users.fullName, role: users.role }).from(users).where(eq(users.active, true));
}

export async function listIntakes(db: DbExecutor, principal: AuthenticatedPrincipal, rawFilters: unknown = {}) {
  await assertScanningPrincipal(db, principal, true);
  const parsed = intakeFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid intake filters.");
  const filters = parsed.data;
  const conditions = [];
  if (filters.resultState) conditions.push(eq(productIntakes.resultState, filters.resultState));
  if (filters.labelStatus) conditions.push(eq(productIntakes.labelStatus, filters.labelStatus));
  if (filters.taskId) conditions.push(eq(productIntakes.taskId, filters.taskId));
  const rows = await db.select({ intake: productIntakes, internalSku: skus.internalSku, scannedByName: users.fullName }).from(productIntakes)
    .leftJoin(skus, eq(skus.id, productIntakes.matchedSkuId)).innerJoin(users, eq(users.id, productIntakes.scannedBy))
    .where(and(...conditions)).orderBy(desc(productIntakes.createdAt), desc(productIntakes.id)).limit(101).offset((filters.page - 1) * 100);
  return { rows: rows.slice(0, 100), hasMore: rows.length > 100 };
}

import { and, asc, desc, eq, gt, inArray, isNull, isNotNull, or } from "drizzle-orm";
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
  if (filters.needsReview === "yes") conditions.push(isNotNull(productIntakes.reviewReason), isNull(productIntakes.reviewedAt));
  if (filters.needsReview === "no") conditions.push(sqlNoReview());
  const rows = await db.select({ intake: productIntakes, internalSku: skus.internalSku, scannedByName: users.fullName }).from(productIntakes)
    .leftJoin(skus, eq(skus.id, productIntakes.matchedSkuId)).innerJoin(users, eq(users.id, productIntakes.scannedBy))
    .where(and(...conditions)).orderBy(desc(productIntakes.createdAt), desc(productIntakes.id)).limit(101).offset((filters.page - 1) * 100);
  return { rows: rows.slice(0, 100), hasMore: rows.length > 100 };
}

function sqlNoReview() { return or(isNull(productIntakes.reviewReason), isNotNull(productIntakes.reviewedAt)); }

const scannerTaskFields = { id: scanTasks.id, title: scanTasks.title, status: scanTasks.status,
  completedCount: scanTasks.completedCount, targetCount: scanTasks.targetCount, dueDate: scanTasks.dueDate, photosRequired: scanTasks.photosRequired };
function scannerAssignment(principal: AuthenticatedPrincipal) {
  return principal.role === "ADMIN" ? undefined : or(eq(scanTasks.assigneeUserId, principal.userId), eq(scanTasks.assigneeRole, principal.role));
}

/** Scanner reads expose only assigned intake work, never administration or other users. */
export async function listAssignedScanTasks(db: DbExecutor, principal: AuthenticatedPrincipal, page = 1) {
  await assertScanningPrincipal(db, principal);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new AppError("VALIDATION_ERROR", "Invalid page.");
  const rows = await db.select(scannerTaskFields).from(scanTasks).where(and(scannerAssignment(principal),
    eq(scanTasks.taskType, "INTAKE_UNIQUE"), inArray(scanTasks.status, ["OPEN", "IN_PROGRESS"])))
    .orderBy(asc(scanTasks.dueDate), asc(scanTasks.createdAt), asc(scanTasks.id)).limit(51).offset((page - 1) * 50);
  return { rows: rows.slice(0, 50), hasMore: rows.length > 50 };
}

export async function getAssignedScanTask(db: DbExecutor, principal: AuthenticatedPrincipal, taskId: string) {
  await assertScanningPrincipal(db, principal);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) throw new AppError("VALIDATION_ERROR", "Invalid task ID.");
  const [task] = await db.select(scannerTaskFields).from(scanTasks).where(and(eq(scanTasks.id, taskId),
    eq(scanTasks.taskType, "INTAKE_UNIQUE"), scannerAssignment(principal))).limit(1);
  if (!task) throw new AppError("NOT_FOUND", "Assigned intake task not found.");
  return task;
}

/** A task-scoped duplicate cache contains identifiers and intake references only. */
export async function listTaskPhotoIdentifiers(db: DbExecutor, principal: AuthenticatedPrincipal, taskId: string, cursor?: string) {
  await getAssignedScanTask(db, principal, taskId);
  if (cursor && !/^[a-f0-9-]{36}$/i.test(cursor)) throw new AppError("VALIDATION_ERROR", "Invalid cursor.");
  const rows = await db.select({ id: productIntakes.id, key: productIntakes.normalizedIdentifier, duplicateOf: productIntakes.duplicateOfIntakeId, internalSku: skus.internalSku })
    .from(productIntakes).leftJoin(skus, eq(skus.id, productIntakes.matchedSkuId)).where(and(eq(productIntakes.taskId, taskId), cursor ? gt(productIntakes.id, cursor) : undefined)).orderBy(asc(productIntakes.id)).limit(1001);
  const page = rows.slice(0, 1000);
  return { identifiers: page.flatMap((row) => [...(row.key ? [{ key: row.key, intakeId: row.duplicateOf ?? row.id }] : []), ...(row.internalSku ? [{ key: `INTERNAL:${row.internalSku}`, intakeId: row.duplicateOf ?? row.id }] : [])]), nextCursor: rows.length > 1000 ? page.at(-1)!.id : null };
}

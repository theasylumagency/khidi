import { beforeAll, describe, expect, it } from "vitest";
import { and,eq } from "drizzle-orm";
import { loadPrincipalByUserId, type AuthenticatedPrincipal } from "@khidi/auth";
import { getDb, scanTasks, skus, users } from "@khidi/db";
import { submitSkuEvidence } from "@khidi/evidence";
import { createUuidV7 } from "@khidi/shared";
import { createScanTask, getAssignedScanTask, listAssignedScanTasks, listIntakes, listScanTasks, markLabelsPrinted, receiveIntake } from "./index.ts";

describe("M3 S4 task administration and Quick Scan", () => {
  const db = getDb();
  let admin: AuthenticatedPrincipal, warehouse: AuthenticatedPrincipal;
  beforeAll(async () => {
    const [a] = await db.select().from(users).where(and(eq(users.role, "ADMIN"),eq(users.active,true),eq(users.totpEnrollmentRequired,false))).limit(1);
    const [w] = await db.select().from(users).where(and(eq(users.role, "WAREHOUSE"),eq(users.active,true),eq(users.totpEnrollmentRequired,false))).limit(1);
    admin = await loadPrincipalByUserId(db, a!.id); warehouse = await loadPrincipalByUserId(db, w!.id);
  });
  const taskInput = () => ({ idempotencyKey: createUuidV7(), taskType: "INTAKE_UNIQUE", title: "Unique intake", assigneeRole: "WAREHOUSE", targetCount: 27, dueDate: "2026-12-01T12:00:00+04:00" });
  it("creates one task on replay, validates assignment and preserves the UTC due date", async () => {
    const input = taskInput();
    const first = await createScanTask(db, admin, input);
    const replay = await createScanTask(db, admin, input);
    expect(replay.replayed).toBe(true); expect(replay.body).toEqual(first.body);
    const [task] = await db.select().from(scanTasks).where(eq(scanTasks.id, first.body.id));
    expect(task).toMatchObject({ taskType: "INTAKE_UNIQUE", completedCount: 0, targetCount: 27, assigneeRole: "WAREHOUSE" });
    expect(task!.dueDate!.toISOString()).toBe("2026-12-01T08:00:00.000Z");
    await expect(createScanTask(db, admin, { ...taskInput(), assigneeUserId: warehouse.userId })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createScanTask(db, admin, { ...taskInput(), targetCount: -1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("keeps physical counts disabled under ADR-013", async () => {
    await expect(createScanTask(db, admin, { ...taskInput(), taskType: "PHYSICAL_COUNT" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", details: { blockedReason: "PHYSICAL_COUNT_DISABLED_ADR013" } });
  });
  it("reports picking as available from M9", async () => {
    await expect(createScanTask(db, admin, { ...taskInput(), taskType: "PICK" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", details: { milestone: 9 } });
  });
  it("assigns and completes an evidence capture task without accepting its evidence", async () => {
    const [sku] = await db.select({ id: skus.id }).from(skus).where(eq(skus.internalSku, "KH-000001"));
    const created = await createScanTask(db, admin, { ...taskInput(), taskType: "EVIDENCE_REQUEST", targetCount: 1,
      targetSkuId: sku!.id, photoRequestNote: "Measure the verified fixture", assigneeRole: null, assigneeUserId: warehouse.userId });
    expect((await getAssignedScanTask(db, warehouse, created.body.id)).taskType).toBe("EVIDENCE_REQUEST");
    const item = await submitSkuEvidence(db, { userId: warehouse.userId }, { skuId: sku!.id, taskId: created.body.id,
      type: "MEASUREMENT", claims: { weight_kg: 11 }, measurementMethod: "Warehouse scale", measurementUnit: "kg" });
    expect(item).toMatchObject({ status: "PENDING", sensitivity: "INTERNAL_ONLY", authorId: warehouse.userId });
    expect(await getAssignedScanTask(db, warehouse, created.body.id)).toMatchObject({ status: "COMPLETED", completedCount: 1 });
  });
  it("rejects every non-admin role for task creation and keeps warehouse users out of task/intake administration", async () => {
    for (const role of ["OPERATOR","STOCK_MANAGER","WAREHOUSE","ORDER_MANAGER"]) {
      const [user] = await db.insert(users).values({id:createUuidV7(),fullName:"Task authorization fixture",role}).returning();
      const principal = await loadPrincipalByUserId(db, user!.id);
      await expect(createScanTask(db, principal, taskInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(listScanTasks(db, warehouse)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listIntakes(db, warehouse)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("filters admin intake history by task, result and label status", async () => {
    const task = await createScanTask(db, admin, taskInput());
    const accepted = await receiveIntake(db, warehouse, { idempotencyKey: createUuidV7(), userId: warehouse.userId, deviceId: createUuidV7(), scannedAt: new Date().toISOString(), sourceMode: "TASK", taskId: task.body.id, isNoBarcode: true });
    expect((await listIntakes(db, admin, { taskId: task.body.id, resultState: "NEW_DRAFT", labelStatus: "TO_PRINT" })).rows.map((r) => r.intake.id)).toEqual([accepted.body.id]);
    expect((await listIntakes(db, admin, { taskId: task.body.id, resultState: "MATCHED_EXISTING" })).rows).toEqual([]);
    await markLabelsPrinted(db, admin, { idempotencyKey: createUuidV7(), intakeIds: [accepted.body.id] });
    expect((await listIntakes(db, admin, { taskId: task.body.id, labelStatus: "PRINTED" })).rows.map((r) => r.intake.id)).toEqual([accepted.body.id]);
    await expect(listIntakes(db, admin, { labelStatus: "INVALID" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("shows assigned intake work and progress without exposing another user's tasks or administration", async () => {
    const roleTask = await createScanTask(db, admin, taskInput());
    const ownTask = await createScanTask(db, admin, { ...taskInput(), assigneeRole: null, assigneeUserId: warehouse.userId });
    const otherTask = await createScanTask(db, admin, { ...taskInput(), assigneeRole: "OPERATOR" });
    const cancelled = await createScanTask(db, admin, taskInput());
    await db.update(scanTasks).set({ status: "CANCELLED" }).where(eq(scanTasks.id, cancelled.body.id));
    const rows = (await listAssignedScanTasks(db, warehouse)).rows;
    expect(rows.some((task) => task.id === roleTask.body.id)).toBe(true);
    expect(rows.some((task) => task.id === ownTask.body.id)).toBe(true);
    expect(rows.some((task) => task.id === otherTask.body.id || task.id === cancelled.body.id)).toBe(false);
    const selected = await getAssignedScanTask(db, warehouse, ownTask.body.id);
    expect(selected).toMatchObject({ targetCount: 27, completedCount: 0 });
    expect(selected).not.toHaveProperty("createdBy"); expect(selected).not.toHaveProperty("assigneeUserId");
    await expect(getAssignedScanTask(db, warehouse, otherTask.body.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getAssignedScanTask(db, admin, otherTask.body.id)).id).toBe(otherTask.body.id);
    await db.update(scanTasks).set({ assigneeRole: "OPERATOR", assigneeUserId: null }).where(eq(scanTasks.id, ownTask.body.id));
    await expect(getAssignedScanTask(db, warehouse, ownTask.body.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getAssignedScanTask(db, warehouse, "invalid")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

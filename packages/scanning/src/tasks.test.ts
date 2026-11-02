import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadPrincipalByUserId, type AuthenticatedPrincipal } from "@khidi/auth";
import { getDb, scanTasks, users } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import { createScanTask, listIntakes, listScanTasks, markLabelsPrinted, receiveIntake } from "./index.ts";

describe("M3 S4 task administration and Quick Scan", () => {
  const db = getDb();
  let admin: AuthenticatedPrincipal, warehouse: AuthenticatedPrincipal;
  beforeAll(async () => {
    const [a] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
    const [w] = await db.select().from(users).where(eq(users.role, "WAREHOUSE")).limit(1);
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
  it.each([["PHYSICAL_COUNT", 8], ["PHOTO_REQUEST", 4], ["EVIDENCE_REQUEST", 5], ["PICK", 9]])("reports %s as available from M%s", async (taskType, milestone) => {
    await expect(createScanTask(db, admin, { ...taskInput(), taskType })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", details: { milestone } });
  });
  it("rejects every non-admin role for task creation and keeps warehouse users out of task/intake administration", async () => {
    const staff = await db.select().from(users);
    for (const user of staff.filter((user) => user.active && user.role !== "ADMIN")) {
      const principal = await loadPrincipalByUserId(db, user.id);
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
});

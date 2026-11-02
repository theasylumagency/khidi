import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadPrincipalByUserId, type AuthenticatedPrincipal } from "@khidi/auth";
import { auditLogs, getDb, productImages, scanTasks, users } from "@khidi/db";
import { createSkuDraft } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { FilesystemMediaStorage } from "../../media/src/storage.ts";
import { fixturePhoto } from "../../media/src/test-fixtures.ts";
import { receivePhoto } from "@khidi/media";
import { createScanTask, getAssignedScanTask, listAssignedScanTasks, listTaskPhotoIdentifiers, receiveIntake } from "./index.ts";
describe("P7 specific PHOTO_REQUEST lifecycle", () => {
  const db = getDb(); let admin: AuthenticatedPrincipal, warehouse: AuthenticatedPrincipal, operator: AuthenticatedPrincipal, skuId: string, storage: FilesystemMediaStorage, root: string, bytes: Buffer;
  beforeAll(async () => {
    const staff = await db.select().from(users);
    [admin, warehouse, operator] = await Promise.all(["ADMIN", "WAREHOUSE", "OPERATOR"].map((role) => loadPrincipalByUserId(db, staff.find((u) => u.role === role)!.id))) as [AuthenticatedPrincipal, AuthenticatedPrincipal, AuthenticatedPrincipal];
    skuId = (await createSkuDraft(db, { userId: admin.userId }, {})).id; root = await mkdtemp(path.join(tmpdir(), "khidi-photo-request-test-")); storage = new FilesystemMediaStorage(root); bytes = await fixturePhoto();
  });
  afterAll(async () => { if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("khidi-photo-request-test-")) throw new Error("Unsafe cleanup."); await rm(root, { recursive: true, force: true }); });
  const input = () => ({ idempotencyKey: createUuidV7(), taskType: "PHOTO_REQUEST", title: "Photograph plate and main view", assigneeUserId: warehouse.userId, targetSkuId: skuId, requestedPhotoSlots: ["MAIN", "IDENTIFICATION"], photoRequestNote: "Keep the full model plate readable" });
  it("validates SKU, note, distinct slots, warehouse assignment and admin-only creation", async () => {
    await expect(createScanTask(db, warehouse, input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const change of [{ photoRequestNote: " " }, { requestedPhotoSlots: [] }, { requestedPhotoSlots: ["MAIN", "MAIN"] }, { targetSkuId: null }, { assigneeUserId: operator.userId }]) await expect(createScanTask(db, admin, { ...input(), ...change })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createScanTask(db, admin, { ...input(), targetSkuId: createUuidV7() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("completes only after all requested Tier-1 photos, replays after closure, and keeps completed history", async () => {
    const request = input(), task = await createScanTask(db, admin, request); expect((await createScanTask(db, admin, request)).replayed).toBe(true);
    expect(await getAssignedScanTask(db, warehouse, task.body.id)).toMatchObject({ taskType: "PHOTO_REQUEST", targetSkuId: skuId, photoRequestNote: request.photoRequestNote, targetCount: 2 });
    await expect(getAssignedScanTask(db, operator, task.body.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const photo = { idempotencyKey: createUuidV7(), userId: warehouse.userId, deviceId: createUuidV7(), capturedAt: new Date().toISOString(), slot: "MAIN", photoRequestTaskId: task.body.id };
    await expect(receivePhoto(db, storage, warehouse, photo, await fixturePhoto(64, 64))).rejects.toMatchObject({ details: { mediaReason: "RESOLUTION" } });
    await receivePhoto(db, storage, warehouse, photo, bytes);
    let [row] = await db.select().from(scanTasks).where(eq(scanTasks.id, task.body.id)); expect(row).toMatchObject({ status: "IN_PROGRESS", completedCount: 1, completedAt: null });
    const final = { ...photo, idempotencyKey: createUuidV7(), slot: "IDENTIFICATION" }; await receivePhoto(db, storage, warehouse, final, bytes);
    expect((await receivePhoto(db, storage, warehouse, final, bytes)).replayed).toBe(true);
    [row] = await db.select().from(scanTasks).where(eq(scanTasks.id, task.body.id)); expect(row).toMatchObject({ status: "COMPLETED", completedCount: 2 }); expect(row!.completedAt).toBeInstanceOf(Date);
    expect((await listAssignedScanTasks(db, warehouse)).rows.some((r) => r.id === task.body.id)).toBe(false);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, task.body.id), eq(auditLogs.action, "SCAN_TASK_COMPLETED")))).toHaveLength(1);
    const images = await db.select().from(productImages).where(eq(productImages.photoRequestTaskId, task.body.id)); expect(images).toHaveLength(2); expect(images.find((i) => i.slot === "IDENTIFICATION")).toMatchObject({ usage: "INTERNAL_EVIDENCE", role: "IDENTITY" });
    await expect(receiveIntake(db, warehouse, { idempotencyKey: createUuidV7(), userId: warehouse.userId, deviceId: photo.deviceId, scannedAt: photo.capturedAt, sourceMode: "TASK", taskId: task.body.id, scannedValue: "NOT-AN-INTAKE" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(listTaskPhotoIdentifiers(db, warehouse, task.body.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

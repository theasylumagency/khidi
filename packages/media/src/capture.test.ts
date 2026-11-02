import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { loadPrincipalByUserId, type AuthenticatedPrincipal } from "@khidi/auth";
import { auditLogs, getDb, imageMasterVersions, intakePhotoStatus, productImages, productIntakes, users } from "@khidi/db";
import { createSkuDraft } from "../../products/src/index.ts";
import { createUuidV7 } from "@khidi/shared";
import { createScanTask, receiveIntake } from "../../scanning/src/index.ts";
import { getPhotoCaptureContext, reportPhotoAttention } from "./capture.ts";
import { receivePhoto } from "./upload.ts";
import { reportOfflinePhotoDiscard } from "./discard.ts";
import { fixturePhoto } from "./test-fixtures.ts";
import { FilesystemMediaStorage } from "./storage.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("P4 capture instructions and explicit inability to photograph", () => {
  const db = getDb(); let admin: AuthenticatedPrincipal, warehouse: AuthenticatedPrincipal, operator: AuthenticatedPrincipal;
  beforeAll(async () => {
    const staff = await db.select().from(users);
    [admin, warehouse, operator] = await Promise.all(["ADMIN", "WAREHOUSE", "OPERATOR"].map((role) => loadPrincipalByUserId(db, staff.find((user) => user.role === role)!.id))) as [AuthenticatedPrincipal, AuthenticatedPrincipal, AuthenticatedPrincipal];
  });
  it("returns generic slots for an unknown review intake and enforces ownership", async () => {
    const task = await createScanTask(db, admin, { idempotencyKey: createUuidV7(), taskType: "INTAKE_UNIQUE", title: "Capture", assigneeRole: "WAREHOUSE" });
    const accepted = await receiveIntake(db, warehouse, { idempotencyKey: createUuidV7(), userId: warehouse.userId, deviceId: createUuidV7(), scannedAt: new Date().toISOString(), taskId: task.body.id, sourceMode: "TASK", scannedValue: "KH-999999" });
    const target = { intakeId: accepted.body.id };
    const context = await getPhotoCaptureContext(db, warehouse, target);
    expect(context.slots.map((slot) => slot.slot)).toEqual(["MAIN", "SECONDARY", "IDENTIFICATION"]);
    expect(context.photosRequired).toBe(true); expect(context.acceptedSlots).toEqual([]);
    await expect(getPhotoCaptureContext(db, operator, target)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const report = { idempotencyKey: createUuidV7(), ...target, userId: warehouse.userId, deviceId: createUuidV7(), capturedAt: new Date().toISOString(), slots: ["MAIN", "SECONDARY", "IDENTIFICATION"], reason: "Product is inaccessible on the upper shelf" };
    expect((await reportPhotoAttention(db, warehouse, report)).body.needsAttention).toBe(true);
    expect((await reportPhotoAttention(db, warehouse, report)).replayed).toBe(true);
    const [intake] = await db.select().from(productIntakes).where(eq(productIntakes.id, accepted.body.id));
    expect(intake).toMatchObject({ photosMissing: true, photoAttentionReason: report.reason });
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, report.idempotencyKey), eq(auditLogs.action, "PHOTO_ATTENTION_REPORTED")))).toHaveLength(1);
    await expect(reportPhotoAttention(db, warehouse, { ...report, idempotencyKey: createUuidV7(), reason: " " })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("routes duplicate and additional captured photos to the original; assigned members can complete them", async () => {
    const sku = await createSkuDraft(db, { userId: admin.userId }, {});
    const task = await createScanTask(db, admin, { idempotencyKey: createUuidV7(), taskType: "INTAKE_UNIQUE", title: "Original photos", assigneeRole: "OPERATOR" });
    const scan = { idempotencyKey: createUuidV7(), userId: admin.userId, deviceId: createUuidV7(), scannedAt: new Date().toISOString(), taskId: task.body.id, sourceMode: "TASK", scannedValue: sku.internalSku };
    const original = await receiveIntake(db, admin, scan);
    const duplicate = await receiveIntake(db, operator, { ...scan, idempotencyKey: createUuidV7(), userId: operator.userId });
    expect(duplicate.body.duplicateOfIntakeId).toBe(original.body.id);
    expect(await db.select().from(intakePhotoStatus).where(eq(intakePhotoStatus.intakeId, duplicate.body.id))).toHaveLength(0);
    const context = await getPhotoCaptureContext(db, operator, { intakeId: duplicate.body.id });
    expect(context).toMatchObject({ isDuplicate: true, originalIntakeId: original.body.id, canCompletePhotos: true });
    await expect(getPhotoCaptureContext(db, warehouse, { intakeId: original.body.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const root = await mkdtemp(path.join(tmpdir(), "khidi-capture-test-"));
    try {
      const store = new FilesystemMediaStorage(root), bytes = await fixturePhoto();
      for (let i = 0; i < 2; i++) {
        const photo = await receivePhoto(db, store, operator, { idempotencyKey: createUuidV7(), userId: operator.userId, deviceId: createUuidV7(), capturedAt: new Date().toISOString(), slot: "MAIN", intakeId: duplicate.body.id }, bytes);
        const [row] = await db.select().from(productImages).where(eq(productImages.id, photo.body.id as string));
        expect(row).toMatchObject({ intakeId: original.body.id, status: "UNVERIFIED", createdBy: operator.userId });
      }
      expect(await db.select().from(productImages).where(eq(productImages.intakeId, duplicate.body.id))).toHaveLength(0);
    } finally {
      if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("khidi-capture-test-")) throw new Error("Unsafe test cleanup.");
      await rm(root, { recursive: true, force: true });
    }
  });
  it("snapshots verified SKU slots as optional, including a fully covered intake", async () => {
    const sku = await createSkuDraft(db, { userId: admin.userId }, {});
    async function verified(slot: string) {
      const id = createUuidV7();
      await db.insert(productImages).values({ id, skuId: sku.id, slot, rawStorageKey: `raw/${id}/original.jpg`, rawSha256: "a".repeat(64), rawBytes: 100,
        mimeType: "image/jpeg", width: 1920, height: 1280, capturedAt: new Date(), deviceId: createUuidV7(), idempotencyKey: id,
        requestHash: "b".repeat(64), tier1QualityJson: { passed: true }, createdBy: admin.userId });
      await db.insert(imageMasterVersions).values({ id: createUuidV7(), imageId: id, version: 1, storageKey: `master/${id}/v1/master.jpg`, sha256: "c".repeat(64), bytes: 100, width: 1920, height: 1920, derivativesJson: {} });
      await db.update(productImages).set({ masterVersion: 1, masterStorageKey: `master/${id}/v1/master.jpg`, masterSha256: "c".repeat(64), status: "VERIFIED", verifiedBy: admin.userId, verifiedAt: new Date() }).where(eq(productImages.id, id));
    }
    async function scan() {
      const task = await createScanTask(db, admin, { idempotencyKey: createUuidV7(), taskType: "INTAKE_UNIQUE", title: "Covered slots", assigneeRole: "WAREHOUSE" });
      return receiveIntake(db, warehouse, { idempotencyKey: createUuidV7(), userId: warehouse.userId, deviceId: createUuidV7(), scannedAt: new Date().toISOString(), taskId: task.body.id, sourceMode: "TASK", scannedValue: sku.internalSku });
    }
    await verified("MAIN");
    const partial = await scan(), context = await getPhotoCaptureContext(db, warehouse, { intakeId: partial.body.id });
    expect(context.slots.find((slot) => slot.slot === "MAIN")).toMatchObject({ required: false, alreadyCovered: true });
    expect(context.missingSlots).toEqual(["SECONDARY", "IDENTIFICATION"]);
    await verified("SECONDARY"); await verified("IDENTIFICATION");
    const covered = await scan();
    const [state] = await db.select().from(intakePhotoStatus).where(eq(intakePhotoStatus.intakeId, covered.body.id));
    expect(state).toMatchObject({ status: "COMPLETE", requiredSlotsJson: [] });
    const [intake] = await db.select().from(productIntakes).where(eq(productIntakes.id, covered.body.id)); expect(intake!.photosMissing).toBe(false);
  });
  it("reports an owner-discarded blocked photo as metadata and marks the original intake for attention", async () => {
    const task = await createScanTask(db, admin, { idempotencyKey: createUuidV7(), taskType: "INTAKE_UNIQUE", title: "Discarded photo", assigneeRole: "WAREHOUSE" });
    const scan = { idempotencyKey: createUuidV7(), userId: warehouse.userId, deviceId: createUuidV7(), scannedAt: new Date().toISOString(), taskId: task.body.id, sourceMode: "TASK", scannedValue: `PHOTO-${createUuidV7()}` };
    const intake = await receiveIntake(db, warehouse, scan);
    const report = { idempotencyKey: createUuidV7(), userId: warehouse.userId, deviceId: scan.deviceId, intakeId: intake.body.id, reason: "Upload rejected; owner discarded", photo: { idempotencyKey: createUuidV7(), slot: "MAIN", sha256: "a".repeat(64), bytes: 123, capturedAt: scan.scannedAt } };
    expect((await reportOfflinePhotoDiscard(db, warehouse, report)).body.needsAttention).toBe(true);
    expect((await reportOfflinePhotoDiscard(db, warehouse, report)).replayed).toBe(true);
    await expect(reportOfflinePhotoDiscard(db, warehouse, { ...report, photo: { ...report.photo, blob: "forbidden bytes" } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(reportOfflinePhotoDiscard(db, operator, report)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [row] = await db.select().from(productIntakes).where(eq(productIntakes.id, intake.body.id)); expect(row).toMatchObject({ photosMissing: true, photoAttentionReason: report.reason });
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, report.idempotencyKey), eq(auditLogs.action, "OFFLINE_PHOTO_DISCARDED")))).toHaveLength(1);
  });
});

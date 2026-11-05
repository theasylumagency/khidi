import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import sharp from "sharp";
import { loadPrincipalByUserId, type AuthenticatedPrincipal } from "@khidi/auth";
import { auditLogs, getDb, idempotencyKeys, intakePhotoStatus, mediaJobs, productImages, productIntakes, scanTasks, skus, users } from "@khidi/db";
import { createScanTask, receiveIntake, resolveIntakeReview } from "../../scanning/src/index.ts";
import { createUuidV7 } from "@khidi/shared";
import { MAX_PHOTO_BYTES, type PhotoUploadInput } from "./contracts.ts";
import { receivePhoto } from "./upload.ts";
import { digest, FilesystemMediaStorage, privateImageKey } from "./storage.ts";
import { fixturePhoto, warningFixturePhoto } from "./test-fixtures.ts";

describe("P3 transactional photo intake", () => {
  const db = getDb(), roots: string[] = [];
  let admin: AuthenticatedPrincipal, warehouse: AuthenticatedPrincipal, operator: AuthenticatedPrincipal, skuId: string, bytes: Buffer;
  beforeAll(async () => {
    const staff = await db.select().from(users);
    [admin, warehouse, operator] = await Promise.all(["ADMIN", "WAREHOUSE", "OPERATOR"].map((role) => loadPrincipalByUserId(db, staff.find((user) => user.role === role)!.id))) as [AuthenticatedPrincipal, AuthenticatedPrincipal, AuthenticatedPrincipal];
    // Review resolution requires a non-archived target, including on a full-suite rerun.
    [skuId] = await db.select({ id: skus.id }).from(skus).where(ne(skus.lifecycleState, "ARCHIVED")).limit(1).then((rows) => rows.map((row) => row.id));
    bytes = await fixturePhoto();
  });
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("khidi-upload-test-")) throw new Error("Unsafe test cleanup path.");
      await rm(root, { recursive: true, force: true });
    }
  });
  async function storage() { const root = await mkdtemp(path.join(tmpdir(), "khidi-upload-test-")); roots.push(root); return new FilesystemMediaStorage(root); }
  const input = (changes: Partial<PhotoUploadInput> = {}): PhotoUploadInput => ({ idempotencyKey: createUuidV7(), userId: admin.userId, deviceId: createUuidV7(), capturedAt: new Date().toISOString(), slot: "MAIN", skuId, intakeId: null, intakeIdempotencyKey: null, photoRequestTaskId: null, ...changes });
  async function intake(value = `PHOTO-${createUuidV7()}`) {
    const task = await createScanTask(db, admin, { idempotencyKey: createUuidV7(), taskType: "INTAKE_UNIQUE", title: "Photo intake", assigneeRole: "WAREHOUSE", photosRequired: true });
    return receiveIntake(db, warehouse, { idempotencyKey: createUuidV7(), userId: warehouse.userId, deviceId: createUuidV7(), scannedAt: new Date().toISOString(), taskId: task.body.id, sourceMode: "TASK", scannedValue: value, isNoBarcode: false });
  }
  it("stores exact original bytes and atomically creates one image/job/audit on replay, including after cache expiry", async () => {
    const store = await storage(), photo = input();
    const first = await receivePhoto(db, store, admin, photo, bytes);
    const replay = await receivePhoto(db, store, admin, photo, bytes);
    expect(replay.body).toEqual(first.body); expect(replay.replayed).toBe(true);
    const [row] = await db.select().from(productImages).where(eq(productImages.id, first.body.id as string));
    expect(await store.readPrivate(row!.rawStorageKey, row!.rawSha256)).toEqual(bytes);
    expect(row).toMatchObject({ width: 1920, height: 1280, rawBytes: bytes.length, rawSha256: digest(bytes), usage: "PUBLIC", role: "MAIN", processingStatus: "PENDING" });
    expect(await db.select().from(mediaJobs).where(eq(mediaJobs.imageId, row!.id))).toHaveLength(1);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, row!.id), eq(auditLogs.action, "IMAGE_UPLOADED")))).toHaveLength(1);
    await db.update(idempotencyKeys).set({ expiresAt: new Date(0) }).where(and(eq(idempotencyKeys.scope, "media:upload"), eq(idempotencyKeys.idempotencyKey, photo.idempotencyKey)));
    expect((await receivePhoto(db, store, admin, photo, bytes)).body).toEqual(first.body);
    await expect(receivePhoto(db, store, admin, { ...photo, slot: "SECONDARY" }, bytes)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(receivePhoto(db, store, admin, photo, new Uint8Array([1]))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("permits the intake scanner and admins, refuses other users, direct warehouse SKU uploads and device/owner changes", async () => {
    const store = await storage(), accepted = await intake();
    const photo = input({ userId: warehouse.userId, skuId: null, intakeId: accepted.body.id, slot: "IDENTIFICATION" });
    await expect(receivePhoto(db, store, operator, { ...photo, userId: operator.userId }, bytes)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(receivePhoto(db, store, warehouse, input({ userId: warehouse.userId }), bytes)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const operatorTask = createUuidV7();
    await db.insert(scanTasks).values({ id: operatorTask, taskType: "PHOTO_REQUEST", title: "Role guard", targetSkuId: skuId, assigneeRole: "OPERATOR", requestedPhotoSlotsJson: ["MAIN"], photoRequestNote: "Permission check", createdBy: admin.userId });
    await expect(receivePhoto(db, store, operator, input({ userId: operator.userId, skuId: null, photoRequestTaskId: operatorTask }), bytes)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(receivePhoto(db, store, warehouse, { ...photo, userId: admin.userId }, bytes)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(receivePhoto(db, store, { ...warehouse, authMethod: "WAREHOUSE_PIN", deviceId: createUuidV7() }, photo, bytes)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const result = await receivePhoto(db, store, warehouse, photo, bytes);
    const [row] = await db.select().from(productImages).where(eq(productImages.id, result.body.id as string));
    expect(row).toMatchObject({ role: "IDENTITY", usage: "INTERNAL_EVIDENCE", createdBy: warehouse.userId });
    expect((await receivePhoto(db, store, admin, { ...photo, userId: admin.userId, idempotencyKey: createUuidV7() }, bytes)).status).toBe(201);
  });
  it("keeps Class A photos SKU-less until the noted admin resolution links them in its transaction", async () => {
    const store = await storage(), accepted = await intake("KH-999999");
    const photo = input({ userId: warehouse.userId, skuId: null, intakeId: accepted.body.id });
    const uploaded = await receivePhoto(db, store, warehouse, photo, bytes);
    expect(uploaded.body.skuId).toBe(null);
    await resolveIntakeReview(db, admin, { idempotencyKey: createUuidV7(), intakeId: accepted.body.id, resolution: "LINK_EXISTING", skuId, note: "Resolved identity from the model plate" });
    const [linked] = await db.select().from(productImages).where(eq(productImages.id, uploaded.body.id as string));
    expect(linked!.skuId).toBe(skuId);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, accepted.body.id), eq(auditLogs.action, "INTAKE_IMAGES_LINKED")))).toHaveLength(1);
  });
  it("requires delivery before accepting dependent photos and enforces photo-request assignment and slots", async () => {
    const store = await storage();
    await expect(receivePhoto(db, store, warehouse, input({ userId: warehouse.userId, skuId: null, intakeIdempotencyKey: createUuidV7() }), bytes)).rejects.toMatchObject({ details: { mediaReason: "DEPENDENCY_PENDING" } });
    const taskId = createUuidV7();
    await db.insert(scanTasks).values({ id: taskId, taskType: "PHOTO_REQUEST", title: "Main photo", targetSkuId: skuId, assigneeRole: "WAREHOUSE", requestedPhotoSlotsJson: ["MAIN"], photoRequestNote: "Need a better main view", createdBy: admin.userId });
    const photo = input({ userId: warehouse.userId, skuId: null, photoRequestTaskId: taskId });
    await expect(receivePhoto(db, store, operator, { ...photo, userId: operator.userId }, bytes)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(receivePhoto(db, store, warehouse, { ...photo, slot: "EXTRA" }, bytes)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await receivePhoto(db, store, warehouse, photo, bytes)).status).toBe(201);
  });
  it("rejects oversized/unsupported/undecodable/bomb files without rows or jobs and can recover an identical orphan", async () => {
    const store = await storage();
    const bomb = Buffer.from(bytes), sof = bomb.indexOf(Buffer.from([0xff, 0xc0]));
    expect(sof).toBeGreaterThan(0); bomb.writeUInt16BE(65535, sof + 5); bomb.writeUInt16BE(65535, sof + 7);
    for (const [invalid, mediaReason] of [[new Uint8Array(MAX_PHOTO_BYTES + 1), "FILE_TOO_LARGE"], [new TextEncoder().encode("<svg/>"), "UNSUPPORTED_FORMAT"], [new Uint8Array([255,216,255,0]), "UNSUPPORTED_FORMAT"], [bomb, "UNSUPPORTED_FORMAT"]] as const) {
      const photo = input(); await expect(receivePhoto(db, store, admin, photo, invalid)).rejects.toMatchObject({ details: { mediaReason } });
      expect(await db.select().from(productImages).where(eq(productImages.id, photo.idempotencyKey))).toHaveLength(0);
    }
    const photo = input(); await store.putPrivate(privateImageKey(photo.idempotencyKey, "original.jpg"), bytes, "image/jpeg");
    expect((await receivePhoto(db, store, admin, photo, bytes)).status).toBe(201);
    const failing = input();
    await expect(receivePhoto(db, { ...store, putPrivate: async () => { throw new Error("Offline storage"); } } as unknown as FilesystemMediaStorage, admin, failing, bytes)).rejects.toThrow("Offline storage");
    expect(await db.select().from(productImages).where(eq(productImages.id, failing.idempotencyKey))).toHaveLength(0);
    expect(await db.select().from(mediaJobs).where(eq(mediaJobs.imageId, failing.idempotencyKey))).toHaveLength(0);
  });
  it("retains a device-accepted photo on server Tier-1 disagreement and flags the original intake", async () => {
    const store = await storage(), accepted = await intake();
    const deviceQuality = { passed: true, reasons: [], width: 1920, height: 1280, variance: 100, darkShare: 0, brightShare: 0 };
    const small = await fixturePhoto(64, 64), photo = input({ userId: warehouse.userId, skuId: null, intakeId: accepted.body.id, deviceQuality });
    expect((await receivePhoto(db, store, warehouse, photo, small)).status).toBe(201);
    const [row] = await db.select().from(productImages).where(eq(productImages.id, photo.idempotencyKey));
    expect(row!.tier1QualityJson).toMatchObject({ passed: true, device: deviceQuality, server: { passed: false, reasons: expect.arrayContaining(["RESOLUTION"]) }, disagreement: true });
    expect(await store.readPrivate(row!.rawStorageKey, row!.rawSha256)).toEqual(small);
    expect(await db.select().from(mediaJobs).where(eq(mediaJobs.imageId, row!.id))).toHaveLength(1);
    for (const slot of ["SECONDARY", "IDENTIFICATION"] as const) await receivePhoto(db, store, warehouse, { ...photo, idempotencyKey: createUuidV7(), slot }, bytes);
    const [state] = await db.select().from(intakePhotoStatus).where(eq(intakePhotoStatus.intakeId, accepted.body.id));
    const [original] = await db.select().from(productIntakes).where(eq(productIntakes.id, accepted.body.id));
    expect(state).toMatchObject({ status: "ATTENTION", attentionReason: "SERVER_TIER1_DISAGREEMENT" });
    expect(original!.photoAttentionReason).toBe("SERVER_TIER1_DISAGREEMENT");
    expect(original!.photosMissing).toBe(false);
  });
  it("accepts a camera JPEG with a minor decoder warning and preserves its exact bytes", async () => {
    const store = await storage(), camera = await warningFixturePhoto(), photo = input();
    await expect(sharp(camera, { failOn: "warning" }).resize(256).raw().toBuffer()).rejects.toThrow();
    expect((await receivePhoto(db, store, admin, photo, camera)).status).toBe(201);
    const [row] = await db.select().from(productImages).where(eq(productImages.id, photo.idempotencyKey));
    expect(await store.readPrivate(row!.rawStorageKey, row!.rawSha256)).toEqual(camera);
    expect(row!.processingStatus).toBe("PENDING");
  });
});

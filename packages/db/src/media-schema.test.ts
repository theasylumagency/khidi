import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createUuidV7 } from "@khidi/shared";
import { getDb, imageMasterVersions, mediaJobs, productImages, productIntakes, scanTasks, skus, users } from "./index.ts";

describe("P2 media database invariants", () => {
  const db = getDb();
  async function fixture() {
    const [admin] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
    const [sku] = await db.select().from(skus).limit(1);
    const id = createUuidV7();
    return { id, skuId: sku!.id, slot: "IDENTIFICATION", rawStorageKey: `raw/${id}/original.jpg`, rawSha256: "a".repeat(64),
      rawBytes: 123, mimeType: "image/jpeg", width: 1920, height: 1080, capturedAt: new Date(), deviceId: createUuidV7(),
      idempotencyKey: createUuidV7(), requestHash: "b".repeat(64), tier1QualityJson: {}, createdBy: admin!.id };
  }
  it("accepts a SKU-less review-intake photo and defaults it to private identity evidence", async () => {
    const data = await fixture();
    const [intake] = await db.insert(productIntakes).values({ id: createUuidV7(), sourceMode: "QUICK_SCAN", scannedBy: data.createdBy,
      clientDeviceId: data.deviceId, isNoBarcode: false, normalizedIdentifier: "INTERNAL_SKU:KH-999999", resultState: "MANUAL_IDENTIFICATION_REQUIRED",
      idempotencyKey: createUuidV7(), requestHash: "test", scannedAt: new Date(), acceptanceResponseJson: {},
      reviewReason: "UNKNOWN_INTERNAL_LABEL", reviewOriginalReason: "UNKNOWN_INTERNAL_LABEL" }).returning();
    const [image] = await db.insert(productImages).values({ ...data, skuId: null, intakeId: intake!.id }).returning();
    expect(image).toMatchObject({ skuId: null, usage: "INTERNAL_EVIDENCE", role: "IDENTITY", masterVersion: 0, status: "UNVERIFIED" });
    await expect(db.insert(productImages).values({ ...data, id: createUuidV7(), skuId: null, intakeId: null })).rejects.toThrow();
    await expect(db.insert(productImages).values({ ...data, id: createUuidV7(), rawSha256: "bad" })).rejects.toThrow();
    await expect(db.update(productImages).set({ rawSha256: "c".repeat(64) }).where(eq(productImages.id, image!.id))).rejects.toThrow(/immutable/);
    await expect(db.delete(productImages).where(eq(productImages.id, image!.id))).rejects.toThrow();
  });
  it("preserves immutable master versions and grants no deletion of media history", async () => {
    const image = await fixture(); await db.insert(productImages).values(image);
    const version = { id: createUuidV7(), imageId: image.id, version: 1, storageKey: `master/${image.id}/v1/master.jpg`, sha256: "c".repeat(64), bytes: 20, width: 1920, height: 1920, derivativesJson: {} };
    await db.insert(imageMasterVersions).values(version);
    await expect(db.update(imageMasterVersions).set({ bytes: 21 }).where(eq(imageMasterVersions.id, version.id))).rejects.toThrow();
    await expect(db.insert(imageMasterVersions).values({ ...version, id: createUuidV7() })).rejects.toThrow();
    await db.insert(imageMasterVersions).values({ ...version, id: createUuidV7(), version: 2, storageKey: `master/${image.id}/v2/master.jpg` });
    expect(await db.select().from(imageMasterVersions).where(eq(imageMasterVersions.imageId, image.id))).toHaveLength(2);
    for (const table of ["product_images", "image_master_versions", "intake_photo_status", "media_jobs", "media_actions", "image_publications"]) {
      const result = await db.execute(sql`SELECT has_table_privilege(current_user, ${table}, 'DELETE') AS can_delete`);
      expect(result.rows[0]).toEqual({ can_delete: false });
    }
  });
  it("requires a reason for rejection, a master for verification, and a PHOTO_REQUEST target/note/slots", async () => {
    const image = await fixture(); await db.insert(productImages).values(image);
    await expect(db.update(productImages).set({ status: "REJECTED" }).where(eq(productImages.id, image.id))).rejects.toThrow();
    await expect(db.update(productImages).set({ status: "VERIFIED", verifiedBy: image.createdBy, verifiedAt: new Date() }).where(eq(productImages.id, image.id))).rejects.toThrow();
    const task = { id: createUuidV7(), taskType: "PHOTO_REQUEST", title: "Retake", assigneeRole: "WAREHOUSE", createdBy: image.createdBy };
    await expect(db.insert(scanTasks).values(task)).rejects.toThrow();
    await expect(db.insert(scanTasks).values({ ...task, targetSkuId: image.skuId, requestedPhotoSlotsJson: ["MAIN", "MAIN"], photoRequestNote: "Retake" })).rejects.toThrow();
    await db.insert(scanTasks).values({ ...task, targetSkuId: image.skuId, requestedPhotoSlotsJson: ["MAIN"], photoRequestNote: "Retake main view" });
    await expect(db.insert(mediaJobs).values({ id: createUuidV7(), jobType: "process-image", imageId: image.id, dedupeKey: createUuidV7() })).rejects.toThrow();
  });
});

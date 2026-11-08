import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { loadPrincipalByUserId, type AuthenticatedPrincipal } from "@khidi/auth";
import { getDb, imageMasterVersions, mediaJobs, outboxDeliveries, productImages, users } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { createUuidV7 } from "@khidi/shared";
import { createSkuDraft } from "../../products/src/index.ts";
import { receivePhoto } from "./upload.ts";
import { executeMediaJob, listMediaJobs, retryMediaJob, markMediaJobDeadLetter } from "./jobs.ts";
import { createMediaJobRuntime, deployMediaJobs, dispatchMediaJobs } from "./jobs-runtime.ts";
import { hashDistance } from "./processing.ts";
import { queueMediaJob } from "./transactions.ts";
import { digest, FilesystemMediaStorage } from "./storage.ts";
import { gpsFixturePhoto } from "./test-fixtures.ts";
describe("P6 retained deterministic processing and durable queue execution", () => {
  const db = getDb(); let admin: AuthenticatedPrincipal, warehouse: AuthenticatedPrincipal, root: string, storage: FilesystemMediaStorage, raw: Buffer;
  beforeAll(async () => {
    const staff = await db.select().from(users); admin = await loadPrincipalByUserId(db, staff.find((u) => u.role === "ADMIN")!.id); warehouse = await loadPrincipalByUserId(db, staff.find((u) => u.role === "WAREHOUSE")!.id);
    root = await mkdtemp(path.join(tmpdir(), "khidi-processing-test-")); storage = new FilesystemMediaStorage(root); raw = await gpsFixturePhoto();
  });
  afterAll(async () => { if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("khidi-processing-test-")) throw new Error("Unsafe cleanup."); await rm(root, { recursive: true, force: true }); });
  async function upload(skuId: string) {
    const photo = await receivePhoto(db, storage, admin, { skuId, idempotencyKey: createUuidV7(), userId: admin.userId, deviceId: createUuidV7(), capturedAt: new Date().toISOString(), slot: "MAIN" }, raw);
    const [job] = await db.select().from(mediaJobs).where(and(eq(mediaJobs.imageId, photo.body.id as string), eq(mediaJobs.jobType, "process-image"))); return { id: photo.body.id as string, job: job! };
  }
  it("preserves raw GPS bytes, strips all metadata from every generated file, retains versions and flags same-SKU duplicates", async () => {
    expect((await sharp(raw).metadata()).orientation).toBe(6); expect((await sharp(raw).metadata()).exif?.includes(Buffer.from([0x25, 0x88]))).toBe(true);
    const sku = await createSkuDraft(db, { userId: admin.userId }, {}), first = await upload(sku.id);
    await executeMediaJob(db, storage, first.job.id); await executeMediaJob(db, storage, first.job.id);
    const [image] = await db.select().from(productImages).where(eq(productImages.id, first.id));
    expect(image).toMatchObject({ masterVersion: 1, processingStatus: "COMPLETED", rawSha256: digest(raw), status: "UNVERIFIED" });
    expect(Buffer.from(await storage.readPrivate(image!.rawStorageKey, image!.rawSha256)).equals(raw)).toBe(true);
    const [version] = await db.select().from(imageMasterVersions).where(eq(imageMasterVersions.imageId, first.id));
    const master = await storage.readPrivate(version!.storageKey, version!.sha256), metadata = await sharp(master).metadata();
    expect(metadata).toMatchObject({ width: 1920, height: 1920, space: "srgb" }); expect(metadata.exif).toBeUndefined(); expect(metadata.orientation).toBeUndefined(); expect(metadata.icc).toBeUndefined();
    expect(Object.keys(version!.derivativesJson)).toHaveLength(6);
    for (const derivative of Object.values(version!.derivativesJson)) {
      const metadata = await sharp(await storage.readPrivate(derivative.key, derivative.sha256)).metadata();
      expect(metadata.width).toBe(derivative.width); expect(metadata.height).toBe(derivative.width); expect(metadata.format).toBe(derivative.format === "avif" ? "heif" : "webp"); expect(metadata.exif).toBeUndefined(); expect(metadata.xmp).toBeUndefined(); expect(metadata.icc).toBeUndefined();
    }
    const next = await withDomainTransaction(db, { userId: admin.userId }, async (ctx) => { await ctx.tx.update(productImages).set({ requestedVersion: 2 }).where(eq(productImages.id, first.id)); return queueMediaJob(ctx, "process-image", { imageId: first.id, imageVersion: 2 }); });
    await executeMediaJob(db, storage, next);
    const versions = await db.select().from(imageMasterVersions).where(eq(imageMasterVersions.imageId, first.id)); expect(versions).toHaveLength(2); expect(await storage.readPrivate(version!.storageKey, version!.sha256)).toEqual(master);
    const second = await upload(sku.id); await executeMediaJob(db, storage, second.job.id);
    const checks = await db.select().from(mediaJobs).where(and(eq(mediaJobs.jobType, "tier2-image-check"), eq(mediaJobs.imageId, first.id), eq(mediaJobs.imageVersion, 2)));
    await executeMediaJob(db, storage, checks[0]!.id);
    const [secondCheck] = await db.select().from(mediaJobs).where(and(eq(mediaJobs.jobType, "tier2-image-check"), eq(mediaJobs.imageId, second.id)));
    await executeMediaJob(db, storage, secondCheck!.id);
    const [checked] = await db.select().from(productImages).where(eq(productImages.id, second.id)); expect(checked!.tier2QualityJson!.nearDuplicates).toEqual([{ imageId: first.id, distance: 0 }]);
    expect(hashDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
  }, 60000);
  it("keeps failed work, reaches dead-letter after three attempts and permits only an audited admin retry", async () => {
    const sku = await createSkuDraft(db, { userId: admin.userId }, {}), image = await upload(sku.id);
    const broken = { ...storage, readPrivate: async () => { throw new Error("Temporary object storage failure"); } } as unknown as FilesystemMediaStorage;
    await expect(executeMediaJob(db, broken, image.job.id)).rejects.toThrow("Temporary");
    let [job] = await db.select().from(mediaJobs).where(eq(mediaJobs.id, image.job.id)); expect(job).toMatchObject({ status: "RETRY", attempts: 1 }); expect(job!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() - 500);
    await expect(executeMediaJob(db, broken, image.job.id)).rejects.toThrow(); expect(await executeMediaJob(db, broken, image.job.id)).toEqual({ deadLetter: true });
    [job] = await db.select().from(mediaJobs).where(eq(mediaJobs.id, image.job.id)); expect(job).toMatchObject({ status: "DEAD_LETTER", attempts: 3 });
    await expect(listMediaJobs(db, warehouse)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const input = { idempotencyKey: createUuidV7(), jobId: job!.id };
    await expect(retryMediaJob(db, warehouse, input)).rejects.toMatchObject({ code: "FORBIDDEN" }); await retryMediaJob(db, admin, input); expect((await retryMediaJob(db, admin, input)).replayed).toBe(true);
    [job] = await db.select().from(mediaJobs).where(eq(mediaJobs.id, image.job.id)); expect(job).toMatchObject({ status: "PENDING", attempts: 0 });
    await markMediaJobDeadLetter(db, image.job.id, 0); await executeMediaJob(db, broken, image.job.id, {}, 0);
    [job] = await db.select().from(mediaJobs).where(eq(mediaJobs.id, image.job.id)); expect(job).toMatchObject({ status: "PENDING", attempts: 0, generation: 1 });
  });
  it("never stores or forwards wrapped database query parameters in a failed job",async()=>{
    const sku=await createSkuDraft(db,{userId:admin.userId},{}),image=await upload(sku.id);
    const driver=Object.assign(new Error("Synthetic database failure"),{code:"23514"});
    const broken={...storage,readPrivate:async()=>{throw new Error("Failed query: private-supplier password=synthetic-secret",{cause:driver});}} as unknown as FilesystemMediaStorage;
    await expect(executeMediaJob(db,broken,image.job.id)).rejects.toThrow("Khidi media database operation failed");
    const [job]=await db.select().from(mediaJobs).where(eq(mediaJobs.id,image.job.id));
    expect(job!.lastError).toBe("DATABASE_ERROR:23514");expect(job!.lastError).not.toMatch(/private-supplier|synthetic-secret|query/);
  });
  it("installs queues only through migrator, runs as hub_app without CREATE and enqueues with its outbox transaction", async () => {
    await deployMediaJobs(); const boss = await createMediaJobRuntime();
    try {
      const privileges = await db.execute(sql`SELECT current_user AS role, has_schema_privilege(current_user, 'khidi_jobs', 'CREATE') AS can_create`); expect(privileges.rows[0]).toEqual({ role: "hub_app", can_create: false });
      await boss.supervise("process-image");
      const sku = await createSkuDraft(db, { userId: admin.userId }, {}), image = await upload(sku.id);
      expect(await dispatchMediaJobs(db, boss, image.job.id)).toBe(1); expect(await dispatchMediaJobs(db, boss, image.job.id)).toBe(0);
      const jobs = await boss.findJobs("process-image"); expect(jobs.some((job) => (job.data as { jobId: string }).jobId === image.job.id)).toBe(true);
      expect((await db.select().from(outboxDeliveries).where(and(eq(outboxDeliveries.consumer, "media-jobs"), eq(outboxDeliveries.status, "DELIVERED")))).length).toBeGreaterThan(0);
    } finally { await boss.stop({ graceful: true }); }
  }, 60000);
});

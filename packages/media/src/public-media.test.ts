import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { and, desc, eq } from "drizzle-orm";
import { loadPrincipalByUserId, type AuthenticatedPrincipal } from "@khidi/auth";
import { getDb, imagePublications, mediaJobs, productImages, skus, storefronts, users } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import { approveCanonicalVersion, createSkuDraft, mergeSkus, saveCanonicalVersion, transitionSkuLifecycle, updateSkuCanonicalSlug } from "../../products/src/index.ts";
import { receivePhoto } from "./upload.ts";
import { executeMediaJob } from "./jobs.ts";
import { manageImage } from "./management.ts";
import { buildPublicMediaUrl, listStorefrontMedia, publicMediaKey, synchronizePublicMedia } from "./public-media.ts";
import { FilesystemMediaStorage, type MediaStorage } from "./storage.ts";
import { fixturePhoto } from "./test-fixtures.ts";
import { makeSamenessFixture } from "../../products/src/sameness.test-fixture.ts";
describe("P9 eligible public copies and recoverable transfer intents", () => {
  const db = getDb(); let admin: AuthenticatedPrincipal, storage: FilesystemMediaStorage, root: string, bytes: Buffer;
  beforeAll(async () => {
    const [user] = await db.select().from(users).where(eq(users.role, "ADMIN")); admin = await loadPrincipalByUserId(db, user!.id);
    root = await mkdtemp(path.join(tmpdir(), "khidi-public-media-test-")); storage = new FilesystemMediaStorage(root); bytes = await fixturePhoto();
  });
  afterAll(async () => { if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("khidi-public-media-test-")) throw new Error("Unsafe cleanup."); await rm(root, { recursive: true, force: true }); });
  async function candidate() {
    const sku = await createSkuDraft(db, { userId: admin.userId }, {});
    const image = await receivePhoto(db, storage, admin, { idempotencyKey: createUuidV7(), skuId: sku.id, userId: admin.userId, deviceId: createUuidV7(), capturedAt: new Date().toISOString(), slot: "MAIN" }, bytes);
    const [job] = await db.select().from(mediaJobs).where(and(eq(mediaJobs.imageId, image.body.id as string), eq(mediaJobs.jobType, "process-image"))); await executeMediaJob(db, storage, job!.id);
    return { skuId: sku.id, imageId: image.body.id as string, slug: `neutral-tool-${createUuidV7().slice(-8)}` };
  }
  const action = (imageId: string, action: string, fields = {}) => manageImage(db, admin, { idempotencyKey: createUuidV7(), imageId, action, ...fields });
  async function ready(item: Awaited<ReturnType<typeof candidate>>) {
    await db.update(skus).set({ lifecycleState: "READY", canonicalSlug: item.slug, reverificationRequired: true }).where(eq(skus.id, item.skuId));
  }
  async function active(skuId: string) { return db.select().from(imagePublications).where(and(eq(imagePublications.skuId, skuId), eq(imagePublications.status, "PUBLISHED"))); }
  it("publishes only VERIFIED PUBLIC images on READY SKUs, builds storefront URLs and withdraws rejected copies", async () => {
    const item = await candidate(); await synchronizePublicMedia(db, storage, item.skuId); expect(await active(item.skuId)).toEqual([]);
    await action(item.imageId, "VERIFY"); await synchronizePublicMedia(db, storage, item.skuId); expect(await active(item.skuId)).toEqual([]);
    await ready(item); await action(item.imageId, "UPDATE", { usage: "INTERNAL_EVIDENCE" }); await synchronizePublicMedia(db, storage, item.skuId); expect(await active(item.skuId)).toEqual([]);
    await action(item.imageId, "UPDATE", { usage: "PUBLIC" }); await synchronizePublicMedia(db, storage, item.skuId); await synchronizePublicMedia(db, storage, item.skuId);
    const copies = await active(item.skuId); expect(copies).toHaveLength(6); expect(await db.select().from(imagePublications).where(eq(imagePublications.skuId, item.skuId))).toHaveLength(6);
    for (const copy of copies) { expect(copy.objectKey).toBe(`${item.slug}-1-${copy.width}.${copy.format}`); expect(copy.objectKey).not.toContain(item.skuId); expect(copy.objectKey).not.toContain(item.imageId); expect((await readFile(path.join(root, "public", copy.objectKey))).byteLength).toBeGreaterThan(0); }
    const [storefront] = await db.select().from(storefronts).limit(1); const urls = await listStorefrontMedia(db, item.skuId, storefront!.id); expect(urls).toHaveLength(6); expect(urls.every((image) => image.url.startsWith(storefront!.mediaBaseUrl.replace(/\/$/, "") + "/"))).toBe(true);
    await action(item.imageId, "REJECT", { reason: "Product edge cropped" }); expect(await listStorefrontMedia(db, item.skuId, storefront!.id)).toEqual([]);
    await synchronizePublicMedia(db, storage, item.skuId); expect(await active(item.skuId)).toEqual([]);
    for (const copy of copies) await expect(readFile(path.join(root, "public", copy.objectKey))).rejects.toMatchObject({ code: "ENOENT" });
  }, 60000);
  it("enqueues catalog lifecycle/slug changes and removes previous slug copies", async () => {
    const item = await candidate(); await ready(item); await action(item.imageId, "VERIFY"); await synchronizePublicMedia(db, storage, item.skuId); const old = await active(item.skuId);
    await updateSkuCanonicalSlug(db, { userId: admin.userId }, item.skuId, `replacement-${item.slug}`, "Public title corrected");
    let [job] = await db.select().from(mediaJobs).where(and(eq(mediaJobs.skuId, item.skuId), eq(mediaJobs.jobType, "publish-sku-media"))).orderBy(desc(mediaJobs.createdAt), desc(mediaJobs.id)); await executeMediaJob(db, storage, job!.id);
    expect((await active(item.skuId)).every((copy) => copy.objectKey.startsWith(`replacement-${item.slug}-`))).toBe(true);
    for (const copy of old) await expect(readFile(path.join(root, "public", copy.objectKey))).rejects.toMatchObject({ code: "ENOENT" });
    await transitionSkuLifecycle(db, { userId: admin.userId }, item.skuId, "CONTENT_REVIEW", { reason: "Recheck product details" });
    [job] = await db.select().from(mediaJobs).where(and(eq(mediaJobs.skuId, item.skuId), eq(mediaJobs.jobType, "publish-sku-media"))).orderBy(desc(mediaJobs.createdAt), desc(mediaJobs.id)); await executeMediaJob(db, storage, job!.id); expect(await active(item.skuId)).toEqual([]);
  }, 60000);
  it("discovers and withdraws copies even if a storage write succeeded before a failed publication transaction", async () => {
    const item = await candidate(); await ready(item); await action(item.imageId, "VERIFY");
    const failing: MediaStorage = { putPrivate: storage.putPrivate.bind(storage), readPrivate: storage.readPrivate.bind(storage), removePublic: storage.removePublic.bind(storage),
      putPublic: async (key, bytes, type) => { await storage.putPublic(key, bytes, type); throw new Error("Connection lost after object write"); } };
    await expect(synchronizePublicMedia(db, failing, item.skuId)).rejects.toThrow("Connection lost");
    const intents = await db.select().from(imagePublications).where(eq(imagePublications.skuId, item.skuId)); expect(intents).toHaveLength(6); expect(intents.every((row) => row.status === "PENDING")).toBe(true);
    await action(item.imageId, "REJECT", { reason: "Owner requested a new photograph" }); await synchronizePublicMedia(db, storage, item.skuId);
    for (const intent of intents) await expect(readFile(path.join(root, "public", intent.objectKey))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await db.select().from(imagePublications).where(eq(imagePublications.skuId, item.skuId))).every((row) => row.status === "WITHDRAWN")).toBe(true);
  }, 60000);
  it("rejects internal identifiers, traversal, a Hub media host, credentials and non-HTTPS public URLs", () => {
    for (const slug of ["KH-000001", `tool-${createUuidV7()}`, "../tool", "khidi-internal-local-tool"]) expect(() => publicMediaKey(slug, 1, 400, "webp")).toThrow();
    const key = publicMediaKey("neutral-tool", 1, 800, "avif"); expect(buildPublicMediaUrl("https://media.example/catalog", key)).toBe("https://media.example/catalog/neutral-tool-1-800.avif");
    for (const base of ["https://khidi.internal.local/", "https://images.khidi.internal.local/", "http://media.example/", "https://secret:password@media.example/", "https://media.example/KH-000001/", "https://media.example/?secret=1"]) expect(() => buildPublicMediaUrl(base, key)).toThrow();
  });
  it("publishes inherited images under the surviving slug while preserving original ownership", async () => {
    const source = await candidate();
    const target = await candidate();
    await ready(source); await ready(target);
    await action(source.imageId, "VERIFY");
    await synchronizePublicMedia(db, storage, source.skuId);
    const actor = { userId: admin.userId };
    const title = "საწყობის საცდელი ხელსაწყო";
    const { version } = await saveCanonicalVersion(db, actor, { skuId: target.skuId, locale: "ka",
      draft: { displayName: title, shortDescription: title, fullDescription: title, searchAliases: [] } });
    await approveCanonicalVersion(db, actor, { skuId: target.skuId, versionId: version.id });
    const sameness=await makeSamenessFixture(db,actor,source.skuId,target.skuId);
    await mergeSkus(db, actor, { sourceSkuId: source.skuId, targetSkuId: target.skuId,samenessEvidenceId:sameness.id,
      identityConfirmed: true, reason: "Compared the physical markings and configuration of both fixtures" });
    await synchronizePublicMedia(db, storage, source.skuId);
    await synchronizePublicMedia(db, storage, target.skuId);
    expect(await active(source.skuId)).toEqual([]);
    const copies = await active(target.skuId);
    expect(copies).toHaveLength(6);
    expect(copies.every((copy) => copy.imageId === source.imageId && copy.objectKey.startsWith(`${target.slug}-`))).toBe(true);
    const [original] = await db.select().from(productImages).where(eq(productImages.id, source.imageId));
    expect(original?.skuId).toBe(source.skuId);
    await action(source.imageId, "REJECT", { reason: "Updated image review" });
    await synchronizePublicMedia(db, storage, target.skuId);
    expect(await active(target.skuId)).toEqual([]);
  }, 60000);
});

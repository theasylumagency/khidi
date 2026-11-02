import { describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createUuidV7 } from "@khidi/shared/uuid";
import { openScanQueue, OfflineScanQueue } from "./offline.ts";
import { OfflinePhotoQueue, PhotoQueueStore, storageUsage, PhotoQuotaError } from "./offline-photos.ts";
import { normalizeScan } from "./scan-values.ts";
import type { IntakeInput } from "./contracts.ts";
import type { PhotoUploadInput } from "@khidi/media/contracts";
const owner = createUuidV7(), other = createUuidV7(), deviceId = createUuidV7();
const scan = (): IntakeInput => ({ idempotencyKey: createUuidV7(), userId: owner, deviceId, scannedAt: new Date().toISOString(), taskId: createUuidV7(), sourceMode: "TASK", scannedValue: "036000291452", isNoBarcode: false });
const photo = (intakeIdempotencyKey: string, userId = owner): PhotoUploadInput => ({ idempotencyKey: createUuidV7(), userId, deviceId, capturedAt: new Date().toISOString(), slot: "MAIN", intakeIdempotencyKey, intakeId: null, photoRequestTaskId: null, skuId: null });
const ok = { accepted: true, status: 201 };
describe("P5 durable photos, intake dependencies and explicit loss reports", () => {
  it("retains exact blobs on reopen and sends only after its own intake receipt", async () => {
    const factory = new IDBFactory(); let store = await openScanQueue(factory), photos = new PhotoQueueStore(store);
    const input = scan(), image = photo(input.idempotencyKey), blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    await store.add(input, "A"); await photos.add(image, blob, "A"); store.close();
    store = await openScanQueue(factory); photos = new PhotoQueueStore(store);
    expect(new Uint8Array(await (await photos.list())[0]!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    let current = other; const sent = vi.fn(async () => ok);
    const queue = new OfflinePhotoQueue(photos, { currentUserId: async () => current, send: sent, report: async () => ok });
    await queue.flush(); current = owner; await queue.flush(); expect(sent).not.toHaveBeenCalled();
    await store.acceptScan(input, { ...ok, intakeId: createUuidV7(), duplicateOfIntakeId: createUuidV7() });
    await queue.flush(); expect(sent).toHaveBeenCalledOnce(); expect(await photos.list()).toEqual([]); store.close();
  });
  it("never uploads children of a blocked scan; owner discard atomically reports metadata only", async () => {
    const store = await openScanQueue(new IDBFactory()), photos = new PhotoQueueStore(store), input = scan();
    await store.add(input, "A"); const a = photo(input.idempotencyKey), b = { ...photo(input.idempotencyKey), slot: "SECONDARY" as const };
    await photos.add(a, new Blob(["raw-one"]), "A"); await photos.add(b, new Blob(["raw-two"]), "A");
    await store.recordFailure(input.idempotencyKey, 0, 403, true);
    const send = vi.fn(async () => ok), queue = new OfflinePhotoQueue(photos, { currentUserId: async () => owner, send, report: async () => ok });
    await queue.flush(); expect(send).not.toHaveBeenCalled();
    await expect(store.discardBlocked(input.idempotencyKey, other, "wrong owner", true)).rejects.toBeDefined();
    expect(await photos.list()).toHaveLength(2);
    await store.discardBlocked(input.idempotencyKey, owner, "damaged scan", true);
    expect(await photos.list()).toEqual([]); expect(await store.list()).toEqual([]);
    const report = (await store.listDiscards())[0]!.input;
    expect(report.photoCount).toBe(2); expect(report.photos?.map((p) => p.slot)).toEqual(["MAIN", "SECONDARY"]);
    expect(report.photos?.[0]).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: 7 });
    expect(JSON.stringify(report)).not.toContain("raw-one"); expect(JSON.stringify(report)).not.toContain("blob"); store.close();
  });
  it("keeps rejected photos, retries with backoff, and commits retake with its discard report", async () => {
    const store = await openScanQueue(new IDBFactory()), photos = new PhotoQueueStore(store), input = scan();
    await store.acceptScan(input, ok); const original = photo(input.idempotencyKey); await photos.add(original, new Blob(["old"]), "A");
    let now = 0, fails = true; const order: string[] = [];
    const queue = new OfflinePhotoQueue(photos, { currentUserId: async () => owner, now: () => now, send: async () => { order.push("photo"); return fails ? { accepted: false, status: 503 } : ok; }, report: async () => { order.push("report"); return ok; } });
    await queue.flush(); await queue.flush(); expect(order).toEqual(["photo"]);
    now = 1000; await photos.result("photos", original.idempotencyKey, { accepted: false, status: 400, code: "BLUR" }, 0);
    const replacement = await photos.prepare(photo(input.idempotencyKey), new Blob(["new"]), "A");
    await photos.discard(original.idempotencyKey, owner, "retaken", true, replacement);
    expect((await photos.list()).map((p) => p.idempotencyKey)).toEqual([replacement.idempotencyKey]);
    expect((await photos.reports())[0]!.input).not.toHaveProperty("blob");
    fails = false; await queue.flush(); expect(order).toEqual(["photo", "report", "photo"]); expect(await photos.list()).toEqual([]); store.close();
  });
  it("rechecks ownership after each in-flight photo", async () => {
    const store = await openScanQueue(new IDBFactory()), photos = new PhotoQueueStore(store), input = scan(); await store.acceptScan(input, ok);
    await photos.add(photo(input.idempotencyKey), new Blob(["a"]), "A"); await photos.add(photo(input.idempotencyKey), new Blob(["b"]), "A");
    let current = owner; const send = vi.fn(async () => { current = other; return ok; });
    await new OfflinePhotoQueue(photos, { currentUserId: async () => current, send, report: async () => ok }).flush();
    expect(send).toHaveBeenCalledOnce(); expect(await photos.list(owner)).toHaveLength(1); store.close();
  });
  it("uses shared GTIN/internal normalization for cached, queued and delivered duplicates", async () => {
    const store = await openScanQueue(new IDBFactory()), photos = new PhotoQueueStore(store), input = scan();
    expect(normalizeScan("036000291452").key).toBe(normalizeScan("0036000291452").key);
    expect(normalizeScan("khidi://sku/kh-000001").key).toBe("INTERNAL:KH-000001");
    await store.add(input, "A"); expect(await photos.duplicate(owner, input.taskId!, "00036000291452")).toMatchObject({ intakeIdempotencyKey: input.idempotencyKey });
    await store.acceptScan(input, { ...ok, intakeId: createUuidV7(), internalSku: "KH-000001" });
    expect(await photos.duplicate(owner, input.taskId!, "kh-000001")).not.toBeNull();
    expect(await photos.duplicate(other, input.taskId!, "kh-000001")).toBeNull();
    await photos.cacheIdentifiers(owner, input.taskId!, [{ key: "VALUE:ABC", intakeId: createUuidV7() }]); expect(await photos.duplicate(owner, input.taskId!, " ABC ")).not.toBeNull(); store.close();
  });
  it("warns at 80%, blocks at 95%, requests persistence, and retains existing photos", async () => {
    const storage = { estimate: async () => ({ usage: 80, quota: 100 }), persist: vi.fn(async () => true) };
    expect(await storageUsage(storage, 0, true)).toMatchObject({ warning: true, blocked: false, persistent: true }); expect(storage.persist).toHaveBeenCalledOnce();
    expect(await storageUsage(storage, 15)).toMatchObject({ blocked: true });
    const store = await openScanQueue(new IDBFactory()), photos = new PhotoQueueStore(store);
    await photos.add(photo(createUuidV7()), new Blob(["x"]), "A");
    await expect(photos.add(photo(createUuidV7()), new Blob(["too-large-for-remaining-space"]), "A", storage)).rejects.toBeInstanceOf(PhotoQuotaError);
    expect(await photos.list()).toHaveLength(1); store.close();
  });
  it("upgrades an existing version-2 queue without losing scans or discard reports", async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve) => { const r = factory.open("old", 2); r.onupgradeneeded = () => { r.result.createObjectStore("scans", { keyPath: "idempotencyKey" }).createIndex("userId", "userId"); r.result.createObjectStore("meta"); r.result.createObjectStore("discards", { keyPath: "idempotencyKey" }).createIndex("userId", "userId"); }; r.onsuccess = () => { r.result.close(); resolve(); }; });
    const store = await openScanQueue(factory, "old"); await store.add(scan(), "A"); expect(await store.list()).toHaveLength(1); expect(await new PhotoQueueStore(store).list()).toEqual([]); store.close();
  });
});

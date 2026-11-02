import { describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createUuidV7 } from "@khidi/shared/uuid";
import { OfflineScanQueue, openScanQueue, retryDelay, type QueueTransportResult } from "./offline.ts";
import type { IntakeInput } from "./contracts.ts";

const userA = createUuidV7(), userB = createUuidV7(), deviceId = createUuidV7();
const scan = (userId = userA): IntakeInput => ({ idempotencyKey: createUuidV7(), userId, deviceId,
  scannedAt: new Date().toISOString(), sourceMode: "QUICK_SCAN", taskId: null, scannedValue: "ABC", isNoBarcode: false });
const accepted: QueueTransportResult = { accepted: true, status: 201 };

describe("M3 S5 durable per-user offline queue", () => {
  it("commits before acknowledging locally, without waiting for the server", async () => {
    const store = await openScanQueue(new IDBFactory());
    let finish!: (value: QueueTransportResult) => void;
    const send = vi.fn(() => new Promise<QueueTransportResult>((resolve) => { finish = resolve; }));
    const queue = new OfflineScanQueue(store, { currentUserId: async () => userA, send });
    const input = scan();
    await queue.enqueue(input, "A");
    expect((await store.list())[0]!.input).toEqual(input);
    const flight = queue.flush();
    // Allow IndexedDB's asynchronous requests to finish; the send remains unresolved.
    while (!finish) await new Promise((resolve) => setImmediate(resolve));
    expect(await store.summary()).toEqual([{ userId: userA, userName: "A", count: 1, blocked: 0 }]);
    finish(accepted); await flight;
    expect(await store.list()).toEqual([]); store.close();
  });
  it("retains the original key, owner, timestamps and stable device ID across app reopen", async () => {
    const factory = new IDBFactory();
    let store = await openScanQueue(factory);
    const input = scan(); const firstDevice = await store.clientDeviceId();
    await store.add(input, "Original user"); store.close();
    store = await openScanQueue(factory);
    expect(await store.clientDeviceId()).toBe(firstDevice);
    expect((await store.list())[0]!.input).toEqual(input);
    const queue = new OfflineScanQueue(store, { currentUserId: async () => userA, send: async () => ({ accepted: true, status: 200 }) });
    await queue.flush(); expect(await store.list()).toEqual([]); store.close();
  });
  it("sends only the active user's entries and reports whom the other pending entries belong to", async () => {
    const store = await openScanQueue(new IDBFactory());
    const a = scan(userA), b = scan(userB);
    await store.add(a, "A"); await store.add(b, "B");
    let current = userB;
    const send = vi.fn(async () => accepted);
    const queue = new OfflineScanQueue(store, { currentUserId: async () => current, send });
    await queue.flush(); expect(send).toHaveBeenCalledExactlyOnceWith(b);
    expect(await store.summary()).toEqual([{ userId: userA, userName: "A", count: 1, blocked: 0 }]);
    current = userA; await queue.flush(); expect(send).toHaveBeenLastCalledWith(a);
    expect(await store.list()).toEqual([]); store.close();
  });
  it("rechecks the session between sends when a PIN user switch happens during a request", async () => {
    const store = await openScanQueue(new IDBFactory());
    const a1 = scan(), a2 = scan(), b = scan(userB);
    await store.add(a1, "A"); await store.add(a2, "A"); await store.add(b, "B");
    let current = userA;
    const send = vi.fn(async () => { current = userB; return accepted; });
    const queue = new OfflineScanQueue(store, { currentUserId: async () => current, send });
    await queue.flush(); expect(send).toHaveBeenCalledExactlyOnceWith(a1);
    expect((await store.list(userA)).map((row) => row.input)).toEqual([a2]);
    await queue.flush(); expect(send).toHaveBeenLastCalledWith(b);
    expect((await store.list()).map((row) => row.input)).toEqual([a2]); store.close();
  });
  it("backs off network and server failures without changing or deleting the original scan", async () => {
    const store = await openScanQueue(new IDBFactory());
    const input = scan(); await store.add(input, "A");
    let now = 100;
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ accepted: false, status: 503 }).mockResolvedValueOnce(accepted);
    const queue = new OfflineScanQueue(store, { currentUserId: async () => userA, send, now: () => now });
    await queue.flush(); expect((await store.list())[0]).toMatchObject({ attempts: 1, nextAttemptAt: 1100, input });
    await queue.flush(); expect(send).toHaveBeenCalledTimes(1);
    now = 1100; await queue.flush(); expect((await store.list())[0]).toMatchObject({ attempts: 2, nextAttemptAt: 3100, input });
    now = 3100; await queue.flush(); expect(await store.list()).toEqual([]);
    expect(retryDelay(1000)).toBe(60000); store.close();
  });
  it("keeps validation failures visible, pauses authentication failures and removes neither", async () => {
    const store = await openScanQueue(new IDBFactory());
    const invalid = scan(), expired = scan(); await store.add(invalid, "A"); await store.add(expired, "A");
    const send = vi.fn().mockResolvedValueOnce({ accepted: false, status: 400 }).mockResolvedValueOnce({ accepted: false, status: 401 });
    const queue = new OfflineScanQueue(store, { currentUserId: async () => userA, send });
    await queue.flush();
    expect(await store.summary()).toEqual([{ userId: userA, userName: "A", count: 2, blocked: 2 }]);
    send.mockResolvedValue(accepted); await queue.retry(); expect(await store.list()).toEqual([]); store.close();
  });
  it("resumes on app start, online and focus without Background Sync", async () => {
    const store = await openScanQueue(new IDBFactory());
    const target = new EventTarget(); let now = 0;
    const send = vi.fn().mockResolvedValueOnce({ accepted: false, status: 503 }).mockResolvedValue(accepted);
    const queue = new OfflineScanQueue(store, { currentUserId: async () => userA, send, now: () => now });
    await store.add(scan(), "A"); queue.start(target); await queue.flush(); expect(send).toHaveBeenCalledTimes(1);
    now = 1000; target.dispatchEvent(new Event("online")); await queue.flush(); expect(await store.list()).toEqual([]);
    await store.add(scan(), "A"); target.dispatchEvent(new Event("focus")); await queue.flush(); expect(await store.list()).toEqual([]);
    queue.stop(); await store.add(scan(), "A"); target.dispatchEvent(new Event("online")); expect(send).toHaveBeenCalledTimes(3);
    store.close();
  });
  it("never resurrects an accepted scan when another tab reports a stale failure", async () => {
    const store = await openScanQueue(new IDBFactory());
    const input = scan(); await store.add(input, "A"); await store.removeAccepted(input.idempotencyKey);
    await store.recordFailure(input.idempotencyKey, 1000, 503, false);
    expect(await store.list()).toEqual([]); store.close();
  });
  it("does not send or acknowledge a scan if durable storage fails", async () => {
    const store = await openScanQueue(new IDBFactory());
    vi.spyOn(store, "add").mockRejectedValueOnce(new DOMException("Quota exceeded", "QuotaExceededError"));
    const send = vi.fn(async () => accepted);
    const queue = new OfflineScanQueue(store, { currentUserId: async () => userA, send });
    await expect(queue.enqueue(scan(), "A")).rejects.toThrow("Quota exceeded");
    expect(send).not.toHaveBeenCalled(); expect(await store.list()).toEqual([]); store.close();
  });
});

describe("S8 confirmed discard outbox", () => {
  it("atomically retains a discard trace offline, sends it only as its owner, and retries until accepted", async () => {
    const factory = new IDBFactory(); let store = await openScanQueue(factory);
    const original = scan(); await store.add(original, "A");
    await store.recordFailure(original.idempotencyKey, 0, 409, true, "IDEMPOTENCY_CONFLICT");
    const offline = new OfflineScanQueue(store, { localUserId: userA, currentUserId: async () => { throw new Error("offline"); }, send: async () => accepted });
    await expect(offline.discard(original.idempotencyKey, "Incorrect entry", false)).rejects.toThrow(/confirmation/);
    const other = new OfflineScanQueue(store, { localUserId: userB, currentUserId: async () => userB, send: async () => accepted });
    await expect(other.discard(original.idempotencyKey, "Not mine", true)).rejects.toThrow();
    expect(await store.list()).toHaveLength(1);
    await offline.discard(original.idempotencyKey, "Wrong physical code", true); await offline.flush();
    expect(await store.list()).toEqual([]);
    expect(await store.summary()).toEqual([{ userId: userA, userName: "A", count: 1, blocked: 0 }]);
    store.close(); store = await openScanQueue(factory);
    const [report] = await store.listDiscards(userA);
    expect(report!.input).toMatchObject({ scanIdempotencyKey: original.idempotencyKey, userId: userA,
      deviceId: original.deviceId, scannedValue: original.scannedValue, scannedAt: original.scannedAt, reason: "Wrong physical code" });
    let current = userB;
    const reportDiscard = vi.fn().mockResolvedValueOnce({ accepted: false, status: 503 }).mockResolvedValue(accepted);
    const sender = new OfflineScanQueue(store, { currentUserId: async () => current, send: async () => accepted, reportDiscard });
    await sender.flush(); expect(reportDiscard).not.toHaveBeenCalled();
    current = userA; await sender.flush(); expect(await store.listDiscards()).toHaveLength(1);
    await sender.retry(); expect(await store.listDiscards()).toEqual([]);
    expect(reportDiscard).toHaveBeenCalledTimes(2); store.close();
  });
  it("upgrades an existing v1 phone queue without losing its scans or device identity", async () => {
    const factory = new IDBFactory(); const original = scan();
    await new Promise<void>((resolve, reject) => {
      const request = factory.open("khidi-scan-queue", 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("scans", { keyPath: "idempotencyKey" }).createIndex("userId", "userId"); request.result.createObjectStore("meta"); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction(["scans", "meta"], "readwrite");
        tx.objectStore("scans").add({ idempotencyKey: original.idempotencyKey, userId: userA, userName: "A", input: original, blocked: true, attempts: 1, nextAttemptAt: 0, lastStatus: 400 });
        tx.objectStore("meta").put(deviceId, "deviceId");
        tx.oncomplete = () => { request.result.close(); resolve(); };
      };
    });
    const store = await openScanQueue(factory);
    expect((await store.list())[0]!.input).toEqual(original);
    expect(await store.clientDeviceId()).toBe(deviceId); expect(await store.listDiscards()).toEqual([]); store.close();
  });
  it("delivers the Class A review outcome and removes the locally accepted scan only after server acceptance", async () => {
    const store = await openScanQueue(new IDBFactory()); const original = scan(); await store.add(original, "A");
    const delivered = vi.fn();
    const queue = new OfflineScanQueue(store, { currentUserId: async () => userA,
      send: async () => ({ accepted: true, status: 201, reviewReason: "UNKNOWN_INTERNAL_LABEL" }), delivered });
    await queue.flush(); expect(await store.list()).toEqual([]);
    expect(delivered).toHaveBeenCalledWith(original, { accepted: true, status: 201, reviewReason: "UNKNOWN_INTERNAL_LABEL" }); store.close();
  });
});

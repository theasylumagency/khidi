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
    expect(await store.summary()).toEqual([{ userId: userA, userName: "A", count: 2, blocked: 1 }]);
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

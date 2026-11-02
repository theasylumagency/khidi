import { createUuidV7 } from "@khidi/shared/uuid";
import type { DiscardInput, IntakeInput, ReviewReason } from "./contracts.ts";

export interface QueuedScan {
  idempotencyKey: string;
  userId: string;
  userName: string;
  input: IntakeInput;
  attempts: number;
  nextAttemptAt: number;
  blocked: boolean;
  lastStatus: number | null;
  lastCode?: string | null;
}
export interface QueuedDiscard {
  idempotencyKey: string; userId: string; userName: string; input: DiscardInput;
  attempts: number; nextAttemptAt: number;
}
export interface PendingUser { userId: string; userName: string; count: number; blocked: number }

export class ScanQueueStore {
  constructor(private readonly database: IDBDatabase) {}
  private transaction<T>(name: string | string[], mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void, tx: IDBTransaction) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      let value: T;
      const tx = this.database.transaction(name, mode);
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error("Offline queue transaction aborted."));
      tx.onerror = () => reject(tx.error ?? new Error("Offline queue storage failed."));
      try { run(tx.objectStore(typeof name === "string" ? name : name[0]!), (result) => { value = result; }, tx); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  async add(input: IntakeInput, userName: string): Promise<void> {
    await this.transaction<void>("scans", "readwrite", (store) => {
      store.add({ idempotencyKey: input.idempotencyKey, userId: input.userId, userName,
        input: structuredClone(input), attempts: 0, nextAttemptAt: 0, blocked: false, lastStatus: null } satisfies QueuedScan);
    });
  }
  async list(userId?: string): Promise<QueuedScan[]> {
    return this.transaction("scans", "readonly", (store, result) => {
      const request = userId ? store.index("userId").getAll(userId) : store.getAll();
      request.onsuccess = () => result((request.result as QueuedScan[]).sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey)));
    });
  }
  async removeAccepted(key: string): Promise<void> {
    await this.transaction<void>("scans", "readwrite", (store) => { store.delete(key); });
  }
  async recordFailure(key: string, nextAttemptAt: number, status: number | null, blocked: boolean, code?: string): Promise<void> {
    await this.transaction<void>("scans", "readwrite", (store) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const existing = request.result as QueuedScan | undefined;
        // Another tab may already have received an acceptance and removed this entry.
        if (existing) store.put({ ...existing, attempts: existing.attempts + 1, nextAttemptAt, lastStatus: status, blocked, lastCode: code ?? null });
      };
    });
  }
  async discardBlocked(key: string, userId: string, reason: string, confirmed: boolean): Promise<string> {
    if (!confirmed || !reason.trim() || reason.trim().length > 4000) throw new Error("A reason and confirmation are required.");
    return this.transaction(["scans", "discards"], "readwrite", (store, result, tx) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const scan = request.result as QueuedScan | undefined;
        if (!scan || scan.userId !== userId || !scan.blocked) { tx.abort(); return; }
        const id = createUuidV7();
        const input: DiscardInput = { idempotencyKey: id, scanIdempotencyKey: scan.idempotencyKey,
          userId, deviceId: scan.input.deviceId, scannedValue: scan.input.scannedValue,
          scannedAt: scan.input.scannedAt, reason: reason.trim() };
        // Moving to the report outbox is atomic: a crash never loses the discard trace.
        tx.objectStore("discards").add({ idempotencyKey: id, userId, userName: scan.userName, input, attempts: 0, nextAttemptAt: 0 } satisfies QueuedDiscard);
        store.delete(key); result(id);
      };
    });
  }
  async listDiscards(userId?: string): Promise<QueuedDiscard[]> {
    return this.transaction("discards", "readonly", (store, result) => {
      const request = userId ? store.index("userId").getAll(userId) : store.getAll();
      request.onsuccess = () => result(request.result as QueuedDiscard[]);
    });
  }
  async discardReportResult(key: string, accepted: boolean, nextAttemptAt: number): Promise<void> {
    await this.transaction<void>("discards", "readwrite", (store) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const existing = request.result as QueuedDiscard | undefined;
        if (!existing) return;
        if (accepted) store.delete(key);
        else store.put({ ...existing, attempts: existing.attempts + 1, nextAttemptAt });
      };
    });
  }
  async retryUser(userId: string): Promise<void> {
    await this.transaction<void>("scans", "readwrite", (store) => {
      const request = store.index("userId").openCursor(userId);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.update({ ...cursor.value, blocked: false, nextAttemptAt: 0 }); cursor.continue();
      };
    });
    await this.transaction<void>("discards", "readwrite", (store) => {
      const request = store.index("userId").openCursor(userId);
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) return;
        cursor.update({ ...cursor.value, nextAttemptAt: 0 }); cursor.continue();
      };
    });
  }
  async clientDeviceId(): Promise<string> {
    return this.transaction("meta", "readwrite", (store, result) => {
      const request = store.get("deviceId");
      request.onsuccess = () => {
        const id: string = request.result ?? createUuidV7();
        if (!request.result) store.add(id, "deviceId");
        result(id);
      };
    });
  }
  async summary(): Promise<PendingUser[]> {
    const byUser = new Map<string, PendingUser>();
    for (const scan of await this.list()) {
      const summary = byUser.get(scan.userId) ?? { userId: scan.userId, userName: scan.userName, count: 0, blocked: 0 };
      summary.count++; if (scan.blocked) summary.blocked++;
      byUser.set(scan.userId, summary);
    }
    for (const discard of await this.listDiscards()) {
      const summary = byUser.get(discard.userId) ?? { userId: discard.userId, userName: discard.userName, count: 0, blocked: 0 };
      summary.count++; byUser.set(discard.userId, summary);
    }
    return [...byUser.values()];
  }
  close() { this.database.close(); }
}

export function openScanQueue(factory: IDBFactory = globalThis.indexedDB, name = "khidi-scan-queue"): Promise<ScanQueueStore> {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error("IndexedDB is unavailable.")); return; }
    const request = factory.open(name, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("scans")) request.result.createObjectStore("scans", { keyPath: "idempotencyKey" }).createIndex("userId", "userId");
      if (!request.result.objectStoreNames.contains("meta")) request.result.createObjectStore("meta");
      request.result.createObjectStore("discards", { keyPath: "idempotencyKey" }).createIndex("userId", "userId");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Offline queue upgrade is blocked by another tab."));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(new ScanQueueStore(request.result));
    };
  });
}

export interface QueueTransportResult { accepted: boolean; status: number; code?: string; reviewReason?: ReviewReason | null }
export interface OfflineQueueOptions {
  localUserId?: string;
  currentUserId: () => Promise<string | null>;
  send: (input: IntakeInput) => Promise<QueueTransportResult>;
  reportDiscard?: (input: DiscardInput) => Promise<QueueTransportResult>;
  delivered?: (input: IntakeInput, result: QueueTransportResult) => void;
  changed?: () => void;
  error?: (error: unknown) => void;
  now?: () => number;
}
export function retryDelay(attempt: number): number { return Math.min(60_000, 1000 * 2 ** Math.min(6, Math.max(0, attempt))); }

/** Framework-independent. Auth is rechecked before each send, including across tabs. */
export class OfflineScanQueue {
  private flight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private target: EventTarget | null = null;
  private running = false;
  private sessionFailures = 0;
  private wakeRequested = false;
  private readonly now: () => number;
  constructor(readonly store: ScanQueueStore, private readonly options: OfflineQueueOptions) { this.now = options.now ?? Date.now; }
  private changed() { try { this.options.changed?.(); } catch (error) { this.options.error?.(error); } }
  private schedule(delay: number) {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, Math.max(25, delay));
  }
  private wake = () => { void this.flush(); };
  start(target?: EventTarget) {
    this.running = true; this.target = target ?? null;
    this.target?.addEventListener("online", this.wake);
    this.target?.addEventListener("focus", this.wake);
    void this.flush();
  }
  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.target?.removeEventListener("online", this.wake);
    this.target?.removeEventListener("focus", this.wake);
  }
  async enqueue(input: IntakeInput, userName: string) {
    await this.store.add(input, userName); // Resolve only after the IDB transaction commits.
    this.changed();
    void this.flush(); // Server latency never delays the acceptance shown by the UI.
  }
  async retry() {
    const userId = await this.options.currentUserId();
    if (userId) await this.store.retryUser(userId);
    this.changed(); await this.flush();
  }
  async discard(key: string, reason: string, confirmed: boolean) {
    // Like scanning, confirmation can happen offline using the displayed user's identity.
    // The server session is verified again before sending the durable discard report.
    const ownerUserId = this.options.localUserId ?? await this.options.currentUserId();
    if (!ownerUserId) throw new Error("An owner session is required.");
    await this.store.discardBlocked(key, ownerUserId, reason, confirmed); this.changed(); void this.flush();
  }
  flush(): Promise<void> {
    if (this.flight) { this.wakeRequested = true; return this.flight; }
    this.flight = this.drain().catch((error) => {
      this.options.error?.(error); this.schedule(retryDelay(this.sessionFailures++));
    }).finally(() => {
      this.flight = null;
      if (this.wakeRequested) { this.wakeRequested = false; this.schedule(25); }
    });
    return this.flight;
  }
  private async drain() {
    let userId = await this.options.currentUserId();
    if (!userId) return;
    this.sessionFailures = 0;
    for (const entry of await this.store.list(userId)) {
      if (entry.blocked || entry.nextAttemptAt > this.now()) continue;
      // A PIN switch may happen while an earlier request is in flight.
      if (await this.options.currentUserId() !== userId) { this.schedule(25); return; }
      let result: QueueTransportResult;
      try { result = await this.options.send(structuredClone(entry.input)); }
      catch {
        await this.store.recordFailure(entry.idempotencyKey, this.now() + retryDelay(entry.attempts), null, false);
        this.changed(); continue;
      }
      if (result.accepted) {
        await this.store.removeAccepted(entry.idempotencyKey);
        try { this.options.delivered?.(entry.input, result); } catch (error) { this.options.error?.(error); }
      }
      else {
        const blocked = result.status >= 400 && result.status < 500 && ![408, 429].includes(result.status);
        await this.store.recordFailure(entry.idempotencyKey, this.now() + retryDelay(entry.attempts), result.status, blocked, result.code);
      }
      this.changed();
      if ([401, 403].includes(result.status) && !result.accepted) break;
    }
    userId = await this.options.currentUserId();
    if (!userId) return;
    if (this.options.reportDiscard) for (const report of await this.store.listDiscards(userId)) {
      if (report.nextAttemptAt > this.now()) continue;
      if (await this.options.currentUserId() !== userId) { this.schedule(25); return; }
      let accepted = false;
      try { accepted = (await this.options.reportDiscard(report.input)).accepted; } catch { /* durable retry */ }
      await this.store.discardReportResult(report.idempotencyKey, accepted, this.now() + retryDelay(report.attempts)); this.changed();
    }
    const pending = (await this.store.list(userId)).filter((entry) => !entry.blocked);
    const reports = await this.store.listDiscards(userId);
    if (pending.length || reports.length && this.options.reportDiscard) this.schedule(Math.min(...pending.map((entry) => entry.nextAttemptAt), ...reports.map((entry) => entry.nextAttemptAt)) - this.now());
  }
}

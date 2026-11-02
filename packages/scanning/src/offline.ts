import { createUuidV7 } from "@khidi/shared/uuid";
import type { IntakeInput } from "./contracts.ts";

export interface QueuedScan {
  idempotencyKey: string;
  userId: string;
  userName: string;
  input: IntakeInput;
  attempts: number;
  nextAttemptAt: number;
  blocked: boolean;
  lastStatus: number | null;
}
export interface PendingUser { userId: string; userName: string; count: number; blocked: number }

export class ScanQueueStore {
  constructor(private readonly database: IDBDatabase) {}
  private transaction<T>(name: string, mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      let value: T;
      const tx = this.database.transaction(name, mode);
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error("Offline queue transaction aborted."));
      tx.onerror = () => reject(tx.error ?? new Error("Offline queue storage failed."));
      try { run(tx.objectStore(name), (result) => { value = result; }); }
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
  async recordFailure(key: string, nextAttemptAt: number, status: number | null, blocked: boolean): Promise<void> {
    await this.transaction<void>("scans", "readwrite", (store) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const existing = request.result as QueuedScan | undefined;
        // Another tab may already have received an acceptance and removed this entry.
        if (existing) store.put({ ...existing, attempts: existing.attempts + 1, nextAttemptAt, lastStatus: status, blocked });
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
    return [...byUser.values()];
  }
  close() { this.database.close(); }
}

export function openScanQueue(factory: IDBFactory = globalThis.indexedDB, name = "khidi-scan-queue"): Promise<ScanQueueStore> {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error("IndexedDB is unavailable.")); return; }
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("scans", { keyPath: "idempotencyKey" }).createIndex("userId", "userId");
      request.result.createObjectStore("meta");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Offline queue upgrade is blocked by another tab."));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(new ScanQueueStore(request.result));
    };
  });
}

export interface QueueTransportResult { accepted: boolean; status: number }
export interface OfflineQueueOptions {
  currentUserId: () => Promise<string | null>;
  send: (input: IntakeInput) => Promise<QueueTransportResult>;
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
      if (result.accepted) await this.store.removeAccepted(entry.idempotencyKey);
      else {
        const blocked = result.status >= 400 && result.status < 500 && ![401, 403, 408, 429].includes(result.status);
        await this.store.recordFailure(entry.idempotencyKey, this.now() + retryDelay(entry.attempts), result.status, blocked);
      }
      this.changed();
      if ([401, 403].includes(result.status) && !result.accepted) break;
    }
    userId = await this.options.currentUserId();
    if (!userId) return;
    const pending = (await this.store.list(userId)).filter((entry) => !entry.blocked);
    if (pending.length) this.schedule(Math.min(...pending.map((entry) => entry.nextAttemptAt)) - this.now());
  }
}

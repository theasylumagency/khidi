import { createUuidV7 } from "@khidi/shared/uuid";
import type { PhotoAttentionInput, PhotoDiscardInput, PhotoTarget, PhotoUploadInput } from "@khidi/media/contracts";
import { photoUploadSchema } from "@khidi/media/contracts";
import { retryDelay, type QueueTransportResult, type ScanQueueStore } from "./offline.ts";
import { normalizeScan } from "./scan-values.ts";
import type { CachedTaskIdentifier, IntakeReceipt, QueuedPhoto, QueuedPhotoReport } from "./photo-queue-contracts.ts";
export type { QueuedPhoto, QueuedPhotoReport, CachedTaskIdentifier } from "./photo-queue-contracts.ts";

export interface StorageUsage { used: number; quota: number | null; ratio: number | null; warning: boolean; blocked: boolean; persistent: boolean }
export interface DeviceStorage { estimate(): Promise<{ usage?: number; quota?: number }>; persist?(): Promise<boolean>; persisted?(): Promise<boolean> }
export async function storageUsage(storage?: DeviceStorage, additionalBytes = 0, requestPersistence = false): Promise<StorageUsage> {
  let persistent = false;
  try { persistent = requestPersistence ? await storage?.persist?.() ?? false : await storage?.persisted?.() ?? false; } catch { /* persistence is advisory; quota checks still apply */ }
  const estimate = await storage?.estimate() ?? {};
  const used = Math.max(0, estimate.usage ?? 0), quota = estimate.quota && estimate.quota > 0 ? estimate.quota : null;
  const ratio = quota ? (used + additionalBytes) / quota : null;
  return { used, quota, ratio, warning: ratio !== null && ratio >= .8, blocked: ratio !== null && ratio >= .95, persistent };
}
export class PhotoQuotaError extends Error {}
export class PhotoQueueStore {
  constructor(readonly scans: ScanQueueStore) {}
  private listStore<T>(name: string, userId?: string): Promise<T[]> {
    return this.scans.transaction(name, "readonly", (store, result) => { const r = userId ? store.index("userId").getAll(userId) : store.getAll(); r.onsuccess = () => result(r.result); });
  }
  async list(userId?: string): Promise<QueuedPhoto[]> {
    const photos = await this.listStore<QueuedPhoto>("photos", userId), keys = [...new Set(photos.map((photo) => photo.input.intakeIdempotencyKey).filter((key): key is string => !!key))];
    if (!keys.length) return photos;
    const receipts = await this.scans.transaction<IntakeReceipt[]>("receipts", "readonly", (store, result) => {
      const rows: IntakeReceipt[] = []; let completed = 0;
      for (const key of keys) { const request = store.get(key); request.onsuccess = () => { if (request.result) rows.push(request.result); if (++completed === keys.length) result(rows); }; }
    });
    return photos.map((photo) => {
      const receipt = receipts.find((row) => row.idempotencyKey === photo.input.intakeIdempotencyKey && row.userId === photo.userId);
      return receipt ? { ...photo, deliveredIntakeId: receipt.duplicateOfIntakeId ?? receipt.intakeId } : photo;
    });
  }
  reports(userId?: string) { return this.listStore<QueuedPhotoReport>("photoReports", userId); }
  hasPending(): Promise<boolean> {
    return this.scans.transaction(["photos", "photoReports"], "readonly", (store, result, tx) => {
      const photos = store.count(), reports = tx.objectStore("photoReports").count(); let completed = 0;
      const read = () => { if (++completed === 2) result(photos.result + reports.result > 0); };
      photos.onsuccess = read; reports.onsuccess = read;
    });
  }
  async prepare(input: PhotoUploadInput, blob: Blob, userName: string, storage?: DeviceStorage): Promise<QueuedPhoto> {
    input = photoUploadSchema.parse(input);
    const usage = await storageUsage(storage, blob.size, true);
    if (usage.blocked) throw new PhotoQuotaError("Photo storage is at its capture limit.");
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { idempotencyKey: input.idempotencyKey, userId: input.userId, userName, input, blob, sha256, bytes: blob.size, attempts: 0, nextAttemptAt: 0, blocked: false };
  }
  async add(input: PhotoUploadInput, blob: Blob, userName: string, storage?: DeviceStorage) {
    const entry = await this.prepare(input, blob, userName, storage);
    await this.scans.transaction<void>("photos", "readwrite", (store) => store.add(entry));
  }
  async report(input: PhotoAttentionInput, userName: string) {
    await this.scans.transaction<void>("photoReports", "readwrite", (store) => store.add({ idempotencyKey: input.idempotencyKey, userId: input.userId, userName, kind: "attention", input, attempts: 0, nextAttemptAt: 0 } satisfies QueuedPhotoReport));
  }
  async dependencyReady(input: { intakeIdempotencyKey: string | null; userId: string }): Promise<boolean> {
    if (!input.intakeIdempotencyKey) return true;
    return this.scans.transaction(["scans", "receipts"], "readonly", (store, result, tx) => {
      const pending = store.get(input.intakeIdempotencyKey!);
      pending.onsuccess = () => {
        if (pending.result) { result(false); return; }
        const delivered = tx.objectStore("receipts").get(input.intakeIdempotencyKey!);
        delivered.onsuccess = () => result((delivered.result as IntakeReceipt | undefined)?.userId === input.userId);
      };
    });
  }
  async result(name: "photos" | "photoReports", key: string, result: QueueTransportResult, nextAttemptAt: number) {
    await this.scans.transaction<void>(name, "readwrite", (store) => {
      const r = store.get(key); r.onsuccess = () => {
        if (!r.result) return;
        if (result.accepted) store.delete(key);
        else store.put({ ...r.result, attempts: r.result.attempts + 1, nextAttemptAt,
          blocked: name === "photos" && result.status >= 400 && result.status < 500 && ![408, 429].includes(result.status) && !(result.status === 412 && result.code === "DEPENDENCY_PENDING"), lastCode: result.code, lastStatus: result.status });
      };
    });
  }
  async discard(key: string, userId: string, reason: string, confirmed: boolean, replacement?: QueuedPhoto): Promise<void> {
    if (!confirmed || !reason.trim() || reason.trim().length > 4000) throw new Error("A reason and confirmation are required.");
    await this.scans.transaction<void>(["photos", "photoReports", "receipts", "scans"], "readwrite", (store, _, tx) => {
      const r = store.get(key); r.onsuccess = () => {
        const photo = r.result as QueuedPhoto | undefined;
        if (!photo || photo.userId !== userId || !photo.blocked) { tx.abort(); return; }
        if (replacement && (replacement.userId !== userId || replacement.input.slot !== photo.input.slot || !sameTarget(photo.input, replacement.input))) { tx.abort(); return; }
        const commit = () => {
          const input: PhotoDiscardInput = { ...photo.input, idempotencyKey: createUuidV7(), reason: reason.trim(), photo: { idempotencyKey: photo.idempotencyKey, slot: photo.input.slot, sha256: photo.sha256, bytes: photo.bytes, capturedAt: photo.input.capturedAt } };
          // Upload-only fields must never leak into the strict metadata report.
          const { idempotencyKey, userId, deviceId, skuId, intakeId, intakeIdempotencyKey, photoRequestTaskId } = input;
          const report: PhotoDiscardInput = { idempotencyKey, userId, deviceId, skuId, intakeId, intakeIdempotencyKey, photoRequestTaskId, reason: input.reason, photo: input.photo };
          tx.objectStore("photoReports").add({ idempotencyKey, userId, userName: photo.userName, kind: "discard", input: report, attempts: 0, nextAttemptAt: 0 } satisfies QueuedPhotoReport);
          store.delete(key);
          if (replacement) store.add(replacement);
        };
        if (!photo.input.intakeIdempotencyKey) { commit(); return; }
        const pending = tx.objectStore("scans").get(photo.input.intakeIdempotencyKey);
        pending.onsuccess = () => {
          if (pending.result) { tx.abort(); return; }
          const receipt = tx.objectStore("receipts").get(photo.input.intakeIdempotencyKey!);
          receipt.onsuccess = () => { if (receipt.result?.userId !== userId) tx.abort(); else commit(); };
        };
      };
    });
  }
  async retry(userId: string) {
    for (const name of ["photos", "photoReports"]) await this.scans.transaction<void>(name, "readwrite", (store) => {
      const r = store.index("userId").openCursor(userId); r.onsuccess = () => { const cursor = r.result; if (!cursor) return; cursor.update({ ...cursor.value, blocked: false, nextAttemptAt: 0 }); cursor.continue(); };
    });
  }
  async cacheIdentifiers(userId: string, taskId: string, entries: CachedTaskIdentifier[]) {
    await this.scans.transaction<void>("meta", "readwrite", (store) => {
      const key = `identifiers:${userId}:${taskId}`, r = store.get(key);
      r.onsuccess = () => {
        const rows: CachedTaskIdentifier[] = r.result ?? [];
        for (const entry of entries) if (!rows.some((row) => row.key === entry.key)) rows.push(entry);
        store.put(rows, key);
      };
    });
  }
  async duplicate(userId: string, taskId: string, value: string): Promise<CachedTaskIdentifier | null> {
    const key = normalizeScan(value).key;
    const cached = await this.scans.transaction<CachedTaskIdentifier[] | undefined>("meta", "readonly", (store, result) => { const r = store.get(`identifiers:${userId}:${taskId}`); r.onsuccess = () => result(r.result); });
    const known = cached?.find((entry) => entry.key === key); if (known) return known;
    const pending = (await this.scans.list(userId)).find((scan) => scan.input.taskId === taskId && !scan.input.isNoBarcode && normalizeScan(scan.input.scannedValue, scan.input.identifierType).key === key);
    return pending ? { key, intakeIdempotencyKey: pending.idempotencyKey } : null;
  }
}
export interface PhotoQueueOptions { currentUserId: () => Promise<string | null>; send: (photo: QueuedPhoto) => Promise<QueueTransportResult>; report: (report: QueuedPhotoReport) => Promise<QueueTransportResult>; changed?: () => void; error?: (error: unknown) => void; now?: () => number }
export class OfflinePhotoQueue {
  private flight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private target?: EventTarget; private running = false;
  private wakeRequested = false; private failures = 0; private nextDelay: number | null = null;
  constructor(readonly store: PhotoQueueStore, private readonly options: PhotoQueueOptions) {}
  private wake = () => { void this.flush(); };
  start(target?: EventTarget) { this.running = true; this.target = target; target?.addEventListener("online", this.wake); target?.addEventListener("focus", this.wake); this.wake(); }
  stop() { this.running = false; if (this.timer) clearTimeout(this.timer); this.target?.removeEventListener("online", this.wake); this.target?.removeEventListener("focus", this.wake); }
  flush(): Promise<void> {
    if (this.flight) { this.wakeRequested = true; return this.flight; }
    this.flight = this.drain().then((delay) => { this.failures = 0; this.nextDelay = delay; }).catch((error) => { this.nextDelay = retryDelay(this.failures++); this.options.error?.(error); }).finally(() => {
      this.flight = null;
      const delay = this.wakeRequested ? 25 : this.nextDelay; this.wakeRequested = false;
      if (this.running && delay !== null) this.timer = setTimeout(this.wake, Math.max(25, delay));
    }); return this.flight;
  }
  private async drain(): Promise<number | null> {
    if (!await this.store.hasPending()) return null;
    const userId = await this.options.currentUserId(); if (!userId) return null;
    const now = this.options.now ?? Date.now;
    // Reasons/discards precede replacement photos; a late report cannot undo completion.
    for (const report of await this.store.reports(userId)) {
      if (report.nextAttemptAt > now() || !await this.store.dependencyReady(report.input)) continue;
      if (await this.options.currentUserId() !== userId) return null;
      let result: QueueTransportResult = { accepted: false, status: 0 };
      try { result = await this.options.report(report); } catch { /* durable retry */ }
      await this.store.result("photoReports", report.idempotencyKey, result, now() + retryDelay(report.attempts)); this.options.changed?.();
      if ([401, 403].includes(result.status)) return null;
    }
    const reports = await this.store.reports(userId);
    for (const photo of await this.store.list(userId)) {
      if (photo.blocked || photo.nextAttemptAt > now() || !await this.store.dependencyReady(photo.input)) continue;
      if (reports.some((r) => sameTarget(r.input, photo.input))) continue;
      if (await this.options.currentUserId() !== userId) return null;
      let result: QueueTransportResult = { accepted: false, status: 0 };
      try { result = await this.options.send(photo); } catch { /* durable retry */ }
      await this.store.result("photos", photo.idempotencyKey, result, now() + retryDelay(photo.attempts)); this.options.changed?.();
      if ([401, 403].includes(result.status)) return null;
    }
    const times: number[] = [];
    for (const photo of await this.store.list(userId)) if (!photo.blocked && await this.store.dependencyReady(photo.input)) times.push(photo.nextAttemptAt);
    for (const report of await this.store.reports(userId)) if (await this.store.dependencyReady(report.input)) times.push(report.nextAttemptAt);
    return times.length ? Math.min(...times) - now() : null;
  }
}
export function sameTarget(a: PhotoTarget, b: PhotoTarget) { return ["intakeId", "intakeIdempotencyKey", "photoRequestTaskId", "skuId"].some((key) => !!a[key as keyof PhotoTarget] && a[key as keyof PhotoTarget] === b[key as keyof PhotoTarget]); }

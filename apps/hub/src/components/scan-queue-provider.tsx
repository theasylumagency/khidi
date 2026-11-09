"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineScanQueue, openScanQueue, type PendingUser, type ScanQueueStore, type QueuedScan, type QueueTransportResult } from "@khidi/scanning/offline";
import { RESULT_STATES, REVIEW_REASONS, type IntakeInput } from "@khidi/scanning/contracts";
import { createUuidV7 } from "@khidi/shared/uuid";
import { formatStaffName, t } from "@khidi/i18n";
import { BlockedScanList } from "./blocked-scan-list.tsx";
import { OfflinePhotoQueue, PhotoQueueStore, storageUsage, type StorageUsage, type QueuedPhoto, type QueuedPhotoReport, type CachedTaskIdentifier } from "@khidi/scanning/offline-photos";
import type { PhotoTarget, PhotoSlot } from "@khidi/media/contracts";
import type { QualityReport } from "@khidi/media/quality";
import { PendingPhotoList } from "./pending-photo-list.tsx";

type ScanDraft = Pick<IntakeInput, "sourceMode" | "taskId" | "scannedValue" | "isNoBarcode">;
interface QueueContextValue {
  ready: boolean; enqueue: (draft: ScanDraft) => Promise<string>;
  lastDelivery: { key: string; result: QueueTransportResult } | null;
  photos: QueuedPhoto[]; photoReports:QueuedPhotoReport[];photoVersion: number; usage: StorageUsage | null; photoReceipts: ReadonlySet<string>;
  enqueuePhoto: (target: Partial<PhotoTarget>, photo: { blob: Blob; slot: PhotoSlot; capturedAt: string; quality: QualityReport }) => Promise<string>;
  enqueueAttention: (target: Partial<PhotoTarget>, reason: string, slots: PhotoSlot[],outcome?:"PLATE_ABSENT"|"LATER") => Promise<void>;
  duplicate: (taskId: string, value: string) => Promise<CachedTaskIdentifier | null>;
  cacheTask: (taskId: string) => Promise<void>;
  checkStorage: () => Promise<void>;
}
const QueueContext = createContext<QueueContextValue | null>(null);
export function useScanQueue() {
  const context = useContext(QueueContext);
  if (!context) throw new Error("ScanQueueProvider is required.");
  return context;
}

export function ScanQueueProvider({ user, children }: {
  user: { userId: string; fullName: string; deviceId: string | null } | null; children: ReactNode
}) {
  const queue = useRef<OfflineScanQueue | null>(null);
  const photoQueue = useRef<OfflinePhotoQueue | null>(null);
  const [photos, setPhotos] = useState<QueuedPhoto[]>([]), [photoVersion, setPhotoVersion] = useState(0), [usage, setUsage] = useState<StorageUsage | null>(null);
  const [photoReports, setPhotoReports] = useState<QueuedPhotoReport[]>([]);
  const [photoReceipts, setPhotoReceipts] = useState<ReadonlySet<string>>(new Set());
  const [ready, setReady] = useState(false), [storageError, setStorageError] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false), [pending, setPending] = useState<PendingUser[]>([]);
  const [blocked, setBlocked] = useState<QueuedScan[]>([]), [discardReports, setDiscardReports] = useState(0);
  const [lastDelivery, setLastDelivery] = useState<QueueContextValue["lastDelivery"]>(null);
  const userId = user?.userId, fullName = user?.fullName, deviceId = user?.deviceId;
  useEffect(() => {
    setPhotoReceipts(new Set());
    if (!userId) return;
    let active = true;
    let store: ScanQueueStore | null = null;
    let controller: OfflineScanQueue | null = null;
    let photoController: OfflinePhotoQueue | null = null;
    async function initialize() {
      store = await openScanQueue();
      if (!active) { store.close(); return; }
      const refresh = () => {
        void Promise.all([store!.summary(), store!.list(userId), store!.listDiscards(userId)]).then(([rows, entries, reports]) => {
          if (!active) return;
          setPending(rows); setBlocked(entries.filter((entry) => entry.blocked)); setDiscardReports(reports.length);
        }).catch(() => { if (active) setStorageError(true); });
      };
      const refreshPhotos = () => {
        void Promise.all([photoController!.store.list(), storageUsage(navigator.storage), photoController!.store.reports()]).then(([rows, usage, reports]) => {
          if (active) { setPhotos(rows); setUsage(usage); setPhotoReports(reports); setPhotoVersion((v) => v + 1); }
        }).catch(() => { if (active) setStorageError(true); });
      };
      const currentUserId = async () => {
        const response = await fetch("/api/scanning/session", { credentials: "same-origin", cache: "no-store", redirect: "error" });
        if (response.status === 401) { if (active) setSessionChanged(true); return null; }
        if (!response.ok) throw new Error("Session unavailable.");
        const body = await response.json(); if (typeof body.userId !== "string") throw new Error("Invalid session.");
        if (active) setSessionChanged(body.userId !== userId); return body.userId as string;
      };
      photoController = new OfflinePhotoQueue(new PhotoQueueStore(store), {
        currentUserId,
        send: async (photo) => {
          const form = new FormData(); form.set("metadata", JSON.stringify(photo.input)); form.set("file", photo.blob, "capture");
          const response = await fetch("/api/media/uploads", { method: "POST", credentials: "same-origin", redirect: "error", headers: { "Idempotency-Key": photo.idempotencyKey }, body: form });
          const body = await response.json();
          const accepted = response.ok && body.id === photo.idempotencyKey && body.rawSha256 === photo.sha256;
          // UI receipts only; queue removal/replay and delivery validation are unchanged.
          if (accepted && active && photo.userId === userId) setPhotoReceipts((previous) => new Set([...previous, photo.idempotencyKey].slice(-500)));
          return { accepted, status: response.status, code: body.mediaReason ?? body.code };
        },
        report: async (report) => {
          const response = await fetch(report.kind === "discard" ? "/api/media/discards" : "/api/media/attention", { method: "POST", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report.input) });
          const body = await response.json(); return { accepted: response.ok && body.id === report.idempotencyKey, status: response.status, code: body.code };
        }, changed: refreshPhotos
      });
      photoQueue.current = photoController;
      controller = new OfflineScanQueue(store, {
        localUserId: userId,
        currentUserId: async () => {
          const response = await fetch("/api/scanning/session", { credentials: "same-origin", cache: "no-store", redirect: "error" });
          if (response.status === 401) { if (active) setSessionChanged(true); return null; }
          if (!response.ok) throw new Error("Session unavailable.");
          const body = await response.json();
          if (typeof body.userId !== "string") throw new Error("Invalid session response.");
          if (active) setSessionChanged(body.userId !== userId);
          return body.userId;
        },
        send: async (input) => {
          const response = await fetch("/api/scanning/intakes", { method: "POST", credentials: "same-origin", redirect: "error",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
          if (!response.ok) {
            let code: string | undefined;
            try { const body = await response.json(); code = body.blockedReason ?? body.code; } catch { /* gateway response */ }
            return { accepted: false, status: response.status, code };
          }
          const body = await response.json();
          // A gateway HTML login response must never remove a queued scan.
          const accepted = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) && RESULT_STATES.includes(body.resultState);
          return { accepted, status: response.status, intakeId: body.id, duplicateOfIntakeId: body.duplicateOfIntakeId ?? null, internalSku: body.internalSku, reviewReason: REVIEW_REASONS.includes(body.reviewReason) ? body.reviewReason : null };
        },
        reportDiscard: async (input) => {
          const response = await fetch("/api/scanning/discards", { method: "POST", credentials: "same-origin", redirect: "error",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
          if (!response.ok) return { accepted: false, status: response.status };
          const body = await response.json();
          return { accepted: body.id === input.idempotencyKey, status: response.status };
        },
        delivered: (input, result) => { if (active && input.userId === userId) { setLastDelivery({ key: input.idempotencyKey, result }); void photoController?.flush(); } },
        changed: refresh
      });
      queue.current = controller; setReady(true); refresh(); refreshPhotos(); controller.start(window); photoController.start(window);
    }
    void initialize().catch(() => { if (active) setStorageError(true); });
    return () => { active = false; controller?.stop(); photoController?.stop(); store?.close(); queue.current = null; photoQueue.current = null; };
  }, [userId]);
  async function enqueue(draft: ScanDraft) {
    const controller = queue.current;
    if (!controller || !userId || !fullName || sessionChanged) throw new Error("Queue is unavailable for this session.");
    const scannedAt = new Date().toISOString();
    const input: IntakeInput = { ...draft, idempotencyKey: createUuidV7(), userId,
      deviceId: deviceId ?? await controller.store.clientDeviceId(), scannedAt };
    try { await controller.enqueue(input, fullName); return input.idempotencyKey; }
    catch (error) { setStorageError(true); throw error; }
  }
  async function photoIdentity() {
    if (!queue.current || !userId || !fullName || sessionChanged) throw new Error("Photo queue unavailable.");
    return { userId, deviceId: deviceId ?? await queue.current.store.clientDeviceId(), idempotencyKey: createUuidV7() };
  }
  async function enqueuePhoto(target: Partial<PhotoTarget>, photo: { blob: Blob; slot: PhotoSlot; capturedAt: string; quality: QualityReport }) {
    const identity = await photoIdentity(), controller = photoQueue.current!;
    await controller.store.add({ skuId: null, intakeId: null, intakeIdempotencyKey: null, photoRequestTaskId: null, ...target, ...identity, slot: photo.slot, capturedAt: photo.capturedAt, deviceQuality: photo.quality }, photo.blob, fullName!, navigator.storage);
    // The add transaction has committed. A failed quota/UI refresh must not turn a
    // saved photo into a failed capture and invite a second enqueue of those bytes.
    try { setPhotos(await controller.store.list()); setUsage(await storageUsage(navigator.storage)); }
    catch { setStorageError(true); }
    setPhotoVersion((v) => v + 1); void controller.flush();
    return identity.idempotencyKey;
  }
  async function enqueueAttention(target: Partial<PhotoTarget>, reason: string, slots: PhotoSlot[],outcome?:"PLATE_ABSENT"|"LATER") {
    const identity = await photoIdentity(), controller = photoQueue.current!;
    await controller.store.report({ skuId: null, intakeId: null, intakeIdempotencyKey: null, photoRequestTaskId: null, ...target, ...identity, reason, slots,...(outcome?{outcome}:{}),capturedAt: new Date().toISOString() }, fullName!);
    setPhotoReports(await controller.store.reports());
    setPhotoVersion((v) => v + 1); void controller.flush();
  }
  async function cacheTask(taskId: string) {
    const controller = photoQueue.current; if (!controller || !userId) return;
    let cursor: string | null = null; const entries: CachedTaskIdentifier[] = [];
    do {
      const response: Response = await fetch(`/api/scanning/tasks/${taskId}/identifiers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", credentials: "same-origin", redirect: "error" });
      if (!response.ok) throw new Error("Task identifiers unavailable.");
      const body: { identifiers: CachedTaskIdentifier[]; nextCursor: string | null } = await response.json(); if (!Array.isArray(body.identifiers) || body.identifiers.some((entry: CachedTaskIdentifier) => typeof entry.key !== "string")) throw new Error("Invalid duplicate cache.");
      entries.push(...body.identifiers); cursor = body.nextCursor;
    } while (cursor);
    await controller.store.cacheIdentifiers(userId, taskId, entries);
  }
  const own = pending.find((row) => row.userId === userId);
  return <QueueContext.Provider value={{ ready: ready && !sessionChanged, enqueue, lastDelivery, photos: photos.filter((photo) => photo.userId === userId),photoReports:photoReports.filter(report=>report.userId===userId), photoVersion, usage, photoReceipts, enqueuePhoto, enqueueAttention, cacheTask,
    duplicate: async (taskId, value) => photoQueue.current && userId ? photoQueue.current.store.duplicate(userId, taskId, value) : null,
    checkStorage: async () => setUsage(await storageUsage(navigator.storage, 0, true)) }}>
    {user ? <aside aria-live="polite" className="scan-queue-status">
      <span>{t("scanning.pending")}: {own?.count ?? 0}</span>
      <span> · {t("media.pending_photos")}: {photos.filter((photo) => photo.userId === userId).length}</span>
      {photoReports.filter((report) => report.userId === userId).length ? <p>{t("media.pending_photo_reports")}: {photoReports.filter((report) => report.userId === userId).length}</p> : null}
      {[...new Set(photoReports.filter((report) => report.userId !== userId).map((report) => report.userId))].map((owner) => <p key={`report:${owner}`}>{t("media.waiting_for_reports").replace("{name}", formatStaffName(photoReports.find((report) => report.userId === owner)!.userName)).replace("{count}", String(photoReports.filter((report) => report.userId === owner).length))}</p>)}
      {usage ? <p>{t("media.storage_used").replace("{used}", (usage.used / 1048576).toFixed(1)).replace("{quota}", usage.quota ? (usage.quota / 1048576).toFixed(0) : "—")}</p> : null}
      {usage?.warning ? <p role="alert">{t(usage.blocked ? "media.quota_blocked" : "media.quota_warning")}</p> : null}
      {[...new Set(photos.filter((photo) => photo.userId !== userId).map((photo) => photo.userId))].map((owner) => <p key={owner}>{t("media.waiting_for_photos").replace("{name}", formatStaffName(photos.find((photo) => photo.userId === owner)!.userName)).replace("{count}", String(photos.filter((photo) => photo.userId === owner).length))}</p>)}
      {pending.filter((row) => row.userId !== userId).map((row) => <p key={row.userId}>{t("scanning.waiting_for").replace("{name}", formatStaffName(row.userName)).replace("{count}", String(row.count))}</p>)}
      {own?.blocked ? <p role="alert">{t("scanning.needs_attention")}: {own.blocked}</p> : null}
      {lastDelivery?.result.reviewReason ? <p role="status">{t("scanning.review_recorded")}</p> : null}
      {discardReports ? <p>{t("scanning.discard_reports_pending")}: {discardReports}</p> : null}
      <BlockedScanList entries={blocked} photos={photos.filter((photo) => photo.userId === userId)} photoCounts={Object.fromEntries(blocked.map((scan) => [scan.idempotencyKey, photos.filter((photo) => photo.input.intakeIdempotencyKey === scan.idempotencyKey).length]))} disabled={sessionChanged} onDiscard={async (key, reason) => {
        if (!queue.current || !userId) throw new Error("Queue is unavailable.");
        await queue.current.discard(key, reason, true);
        setPhotos(await photoQueue.current!.store.list());
      }} />
      <PendingPhotoList photos={photos.filter((photo) => photo.userId === userId && !blocked.some((scan) => scan.idempotencyKey === photo.input.intakeIdempotencyKey))} blockedScanKeys={[]} disabled={sessionChanged} onDiscard={async (photo, reason) => {
        await photoQueue.current!.store.discard(photo.idempotencyKey, userId!, reason, true); setPhotos(await photoQueue.current!.store.list()); setPhotoReports(await photoQueue.current!.store.reports()); void photoQueue.current!.flush();
      }} onRetake={async (photo, blob, quality) => {
        const identity = await photoIdentity(), controller = photoQueue.current!;
        const replacement = await controller.store.prepare({ ...photo.input, ...identity, capturedAt: new Date().toISOString(), deviceQuality: quality }, blob, fullName!, navigator.storage);
        await controller.store.discard(photo.idempotencyKey, userId!, t("media.retake_reason"), true, replacement); setPhotos(await controller.store.list()); setPhotoReports(await controller.store.reports()); void controller.flush();
      }} />
      {own?.count && !sessionChanged ? <button type="button" onClick={() => { void queue.current?.retry().catch(() => setStorageError(true)); }}>{t("scanning.retry")}</button> : null}
      {photos.some((photo) => photo.userId === userId) && !sessionChanged ? <button type="button" onClick={() => { void photoQueue.current?.store.retry(userId!).then(() => photoQueue.current?.flush()); }}>{t("media.retry_photos")}</button> : null}
      {storageError ? <p role="alert">{t("scanning.storage_error")}</p> : null}
      {sessionChanged ? <p role="alert">{t("scanning.session_changed")} <button type="button" onClick={() => window.location.reload()}>{t("scanning.refresh")}</button></p> : null}
    </aside> : null}
    {children}
  </QueueContext.Provider>;
}

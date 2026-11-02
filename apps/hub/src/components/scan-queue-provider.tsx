"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineScanQueue, openScanQueue, type PendingUser, type ScanQueueStore } from "@khidi/scanning/offline";
import { RESULT_STATES, type IntakeInput } from "@khidi/scanning/contracts";
import { createUuidV7 } from "@khidi/shared/uuid";
import { formatStaffName, t } from "@khidi/i18n";

type ScanDraft = Pick<IntakeInput, "sourceMode" | "taskId" | "scannedValue" | "isNoBarcode">;
interface QueueContextValue { ready: boolean; enqueue: (draft: ScanDraft) => Promise<void> }
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
  const [ready, setReady] = useState(false), [storageError, setStorageError] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false), [pending, setPending] = useState<PendingUser[]>([]);
  const userId = user?.userId, fullName = user?.fullName, deviceId = user?.deviceId;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let store: ScanQueueStore | null = null;
    let controller: OfflineScanQueue | null = null;
    async function initialize() {
      store = await openScanQueue();
      if (!active) { store.close(); return; }
      const refresh = () => { void store!.summary().then((rows) => { if (active) setPending(rows); }).catch(() => { if (active) setStorageError(true); }); };
      controller = new OfflineScanQueue(store, {
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
          if (!response.ok) return { accepted: false, status: response.status };
          const body = await response.json();
          // A gateway HTML login response must never remove a queued scan.
          const accepted = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) && RESULT_STATES.includes(body.resultState);
          return { accepted, status: response.status };
        },
        changed: refresh
      });
      queue.current = controller; setReady(true); refresh(); controller.start(window);
    }
    void initialize().catch(() => { if (active) setStorageError(true); });
    return () => { active = false; controller?.stop(); store?.close(); queue.current = null; };
  }, [userId]);
  async function enqueue(draft: ScanDraft) {
    const controller = queue.current;
    if (!controller || !userId || !fullName || sessionChanged) throw new Error("Queue is unavailable for this session.");
    const scannedAt = new Date().toISOString();
    const input: IntakeInput = { ...draft, idempotencyKey: createUuidV7(), userId,
      deviceId: deviceId ?? await controller.store.clientDeviceId(), scannedAt };
    try { await controller.enqueue(input, fullName); }
    catch (error) { setStorageError(true); throw error; }
  }
  const own = pending.find((row) => row.userId === userId);
  return <QueueContext.Provider value={{ ready: ready && !sessionChanged, enqueue }}>
    {user ? <aside aria-live="polite" className="scan-queue-status">
      <span>{t("scanning.pending")}: {own?.count ?? 0}</span>
      {pending.filter((row) => row.userId !== userId).map((row) => <p key={row.userId}>{t("scanning.waiting_for").replace("{name}", formatStaffName(row.userName)).replace("{count}", String(row.count))}</p>)}
      {own?.blocked ? <p role="alert">{t("scanning.needs_attention")}: {own.blocked}</p> : null}
      {own?.count && !sessionChanged ? <button type="button" onClick={() => { void queue.current?.retry().catch(() => setStorageError(true)); }}>{t("scanning.retry")}</button> : null}
      {storageError ? <p role="alert">{t("scanning.storage_error")}</p> : null}
      {sessionChanged ? <p role="alert">{t("scanning.session_changed")} <button type="button" onClick={() => window.location.reload()}>{t("scanning.refresh")}</button></p> : null}
    </aside> : null}
    {children}
  </QueueContext.Provider>;
}

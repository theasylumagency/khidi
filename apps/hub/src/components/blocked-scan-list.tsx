"use client";
import { useState, type FormEvent } from "react";
import type { QueuedScan } from "@khidi/scanning/offline";
import { t, type TranslationKey } from "@khidi/i18n";
import type { QueuedPhoto } from "@khidi/scanning/offline-photos";
import { PendingPhotoList } from "./pending-photo-list.tsx";

const errorKeys: Record<string, TranslationKey> = {
  UNAUTHORIZED: "scanning.error.UNAUTHORIZED", FORBIDDEN: "scanning.error.FORBIDDEN",
  VALIDATION_ERROR: "scanning.error.VALIDATION_ERROR", IDEMPOTENCY_CONFLICT: "scanning.error.IDEMPOTENCY_CONFLICT",
  CONFLICT: "scanning.error.CONFLICT", NOT_FOUND: "scanning.error.NOT_FOUND",
  PRECONDITION_FAILED: "scanning.error.PRECONDITION_FAILED", SCAN_OWNER_MISMATCH: "scanning.blocked_owner",
  SCAN_DEVICE_MISMATCH: "scanning.blocked_device"
};
function BlockedEntry({ entry, photoCount, photos, disabled, onDiscard }: { entry: QueuedScan; photoCount: number; photos: QueuedPhoto[]; disabled: boolean; onDiscard: (key: string, reason: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function discard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (!reason || !window.confirm(photoCount ? t("media.discard_scan_confirm").replace("{count}", String(photoCount)) : t("scanning.discard_confirm"))) return;
    setBusy(true); setError("");
    try { await onDiscard(entry.idempotencyKey, reason); }
    catch { setError(t("scanning.error")); }
    finally { setBusy(false); }
  }
  const fallback = entry.lastStatus === 401 ? "UNAUTHORIZED" : entry.lastStatus === 403 ? "FORBIDDEN" : "VALIDATION_ERROR";
  const time = new Date(entry.input.scannedAt);
  return <li className="blocked-scan"><strong>{entry.input.scannedValue || t("scanning.no_barcode")}</strong>
    <p>{Number.isFinite(time.getTime()) ? new Intl.DateTimeFormat("ka-GE", { timeZone: "Asia/Tbilisi", dateStyle: "short", timeStyle: "short" }).format(time) : t("scanning.unset")}</p>
    <p>{t(errorKeys[entry.lastCode ?? fallback] ?? "scanning.error")}</p>
    {photoCount ? <p>{t("media.photos_under_scan").replace("{count}", String(photoCount))}</p> : null}
    <PendingPhotoList photos={photos} blockedScanKeys={[entry.idempotencyKey]} disabled onDiscard={async () => {}} onRetake={async () => {}} />
    <form onSubmit={discard}><label>{t("scanning.discard_reason")}<input name="reason" required maxLength={4000} disabled={busy || disabled} /></label>
      <button type="submit" disabled={busy || disabled}>{t("scanning.discard")}</button></form>
    {error ? <p role="alert">{error}</p> : null}
  </li>;
}
export function BlockedScanList({ entries, photoCounts = {}, photos = [], disabled, onDiscard }: { entries: QueuedScan[]; photoCounts?: Record<string, number>; photos?: QueuedPhoto[]; disabled: boolean; onDiscard: (key: string, reason: string) => Promise<void> }) {
  if (!entries.length) return null;
  return <details><summary>{t("scanning.blocked_entries")} ({entries.length})</summary>
    <ul>{entries.map((entry) => <BlockedEntry key={entry.idempotencyKey} entry={entry} photoCount={photoCounts[entry.idempotencyKey] ?? 0} photos={photos.filter((photo) => photo.input.intakeIdempotencyKey === entry.idempotencyKey)} disabled={disabled} onDiscard={onDiscard} />)}</ul>
  </details>;
}

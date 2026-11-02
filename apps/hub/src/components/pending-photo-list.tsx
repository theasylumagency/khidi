"use client";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import type { QueuedPhoto } from "@khidi/scanning/offline-photos";
import { checkCapturedPhoto } from "@khidi/media/capture-browser";
import { DEFAULT_QUALITY_CONFIG } from "@khidi/media/quality";
import { t, type TranslationKey } from "@khidi/i18n";
function PhotoEntry({ photo, blockedScan, disabled, onDiscard, onRetake }: { photo: QueuedPhoto; blockedScan: boolean; disabled: boolean; onDiscard: (photo: QueuedPhoto, reason: string) => Promise<void>; onRetake: (photo: QueuedPhoto, blob: Blob) => Promise<void> }) {
  const [url, setUrl] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { const url = URL.createObjectURL(photo.blob); setUrl(url); return () => URL.revokeObjectURL(url); }, [photo.blob]);
  async function discard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (!reason || !window.confirm(t("media.discard_photo_confirm"))) return;
    setBusy(true); try { await onDiscard(photo, reason); } catch { setError(t("media.storage_error")); } finally { setBusy(false); }
  }
  async function retake(event: ChangeEvent<HTMLInputElement>) {
    const blob = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!blob) return;
    if (!window.confirm(t("media.retake_confirm"))) return;
    setBusy(true); setError(""); try { await checkCapturedPhoto(blob, DEFAULT_QUALITY_CONFIG); await onRetake(photo, blob); } catch { setError(t("media.retake_failed")); } finally { setBusy(false); }
  }
  return <li className="blocked-scan">{url ? <img src={url} alt={t(`media.slot.${photo.input.slot}` as TranslationKey)} width={96} height={96} style={{ objectFit: "contain" }} /> : null}
    <strong>{t(`media.slot.${photo.input.slot}` as TranslationKey)}</strong>
    <p>{t(blockedScan ? "media.blocked_parent" : photo.blocked ? "media.blocked_photo" : "media.waiting_upload")}</p>
    {photo.blocked && !blockedScan ? <><p>{t(`media.error.${photo.lastCode}` as TranslationKey) || t("media.error.GENERIC")}</p>
      <label>{t("media.retake")}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy || disabled} onChange={retake} /></label>
      <form onSubmit={discard}><label>{t("scanning.discard_reason")}<input name="reason" required maxLength={4000} disabled={busy || disabled} /></label><button disabled={busy || disabled}>{t("scanning.discard")}</button></form></> : null}
    {error ? <p role="alert">{error}</p> : null}</li>;
}
export function PendingPhotoList({ photos, blockedScanKeys, ...actions }: { photos: QueuedPhoto[]; blockedScanKeys: string[]; disabled: boolean; onDiscard: (photo: QueuedPhoto, reason: string) => Promise<void>; onRetake: (photo: QueuedPhoto, blob: Blob) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!photos.length) return null;
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{t("media.pending_photos")} ({photos.length})</summary>
    {open ? <ul>{photos.map((photo) => <PhotoEntry key={photo.idempotencyKey} photo={photo} blockedScan={blockedScanKeys.includes(photo.input.intakeIdempotencyKey ?? "")} {...actions} />)}</ul> : null}</details>;
}

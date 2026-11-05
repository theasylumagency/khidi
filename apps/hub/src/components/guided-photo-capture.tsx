"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent } from "react";
import { checkCapturedPhoto } from "@khidi/media/capture-browser";
import type { CaptureSlot, PhotoSlot } from "@khidi/media/contracts";
import type { QualityConfig } from "@khidi/media/quality";
import { t, type TranslationKey } from "@khidi/i18n";
import { CameraShell, useParentCameraShell } from "./camera-shell.tsx";
import { PhotoWorkflow, type CapturedPhoto, type SavedPhoto } from "../lib/photo-workflow.ts";
import { recordSessionActivity } from "../lib/session-client.ts";

export interface QueuedPhotoView extends SavedPhoto { blocked: boolean }
function Thumbnail({ blob, label }: { blob?: Blob; label: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (!blob) { setUrl(""); return; } const url = URL.createObjectURL(blob); setUrl(url); return () => URL.revokeObjectURL(url); }, [blob]);
  return url ? <img src={url} alt={label} /> : <span className="photo-saved-icon" aria-hidden="true">✓</span>;
}
export function GuidedPhotoCapture(props: {
  slots: CaptureSlot[]; acceptedSlots: PhotoSlot[]; syncedSlots?: PhotoSlot[]; queuedPhotos?: QueuedPhotoView[]; photoReceipts?: ReadonlySet<string>;
  qualityConfig: QualityConfig; disabled?: boolean; scanNotice?: boolean;
  onAccept: (photo: CapturedPhoto) => Promise<string>;
  onCannotPhotograph: (reason: string, slots: PhotoSlot[]) => Promise<void>; onComplete: (notice?: "attention") => void;
  onPhotoTaken?: () => void; onNativePending?: (pending: boolean) => void;
}) {
  const { slots, acceptedSlots, syncedSlots = [], queuedPhotos = [], photoReceipts = new Set<string>(), disabled, onCannotPhotograph, onComplete } = props;
  const parent = useParentCameraShell(), [open, setOpen] = useState(false);
  const latest = useRef(props); latest.current = props;
  const [workflow] = useState(() => new PhotoWorkflow(slots, acceptedSlots, {
    check: (blob) => checkCapturedPhoto(blob, latest.current.qualityConfig),
    save: (photo) => latest.current.onAccept(photo), taken: () => latest.current.onPhotoTaken?.()
  }));
  const state = useSyncExternalStore(workflow.subscribe, workflow.snapshot, workflow.snapshot);
  const [cannot, setCannot] = useState(false), [reason, setReason] = useState(""), [reporting, setReporting] = useState(false), [reportError, setReportError] = useState(false);
  const [notice, setNotice] = useState(!!props.scanNotice);
  const [savedNotice, setSavedNotice] = useState(false);
  const native = useRef<HTMLInputElement>(null), picker = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const slotsKey = JSON.stringify(slots), acceptedKey = [...acceptedSlots].sort().join("|");
  useEffect(() => { workflow.configure(JSON.parse(slotsKey), acceptedKey.split("|").filter(Boolean) as PhotoSlot[]); }, [workflow, slotsKey, acceptedKey]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(false), 2600); return () => clearTimeout(timer); }, [notice]);
  const lastSavedKey = state.saved.at(-1)?.key;
  useEffect(() => { if (!lastSavedKey) return; setSavedNotice(true); const timer = setTimeout(() => setSavedNotice(false), 2600); return () => clearTimeout(timer); }, [lastSavedKey]);
  useEffect(() => { surfaceRef.current?.scrollTo({ top: 0 }); }, [state.current]);
  useEffect(() => {
    const inputs = [native.current, picker.current], cancel = () => latest.current.onNativePending?.(false);
    inputs.forEach((input) => input?.addEventListener("cancel", cancel));
    return () => inputs.forEach((input) => input?.removeEventListener("cancel", cancel));
  }, []);
  const current = slots.find((slot) => slot.slot === state.current), busy = state.phase !== "idle" || reporting;
  const missing = slots.filter((slot) => slot.required && !state.accepted.includes(slot.slot));
  const title = (slot: CaptureSlot) => slot.titleKa ?? t(`media.slot.${slot.slot}` as TranslationKey);
  const saved = (slot: PhotoSlot) => state.saved.find((photo) => photo.slot === slot) ?? queuedPhotos.findLast((photo) => photo.slot === slot);
  const status = (slot: PhotoSlot) => {
    const photo = saved(slot);
    if (photo && photoReceipts.has(photo.key) || !photo && syncedSlots.includes(slot)) return t("camera.photo_synced");
    if (photo && queuedPhotos.some((item) => item.key === photo.key && item.blocked)) return t("camera.photo_blocked");
    return t("camera.photo_pending");
  };
  function selected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null; event.currentTarget.value = "";
    if (file && event.nativeEvent.isTrusted && !disabled) recordSessionActivity();
    // receive() marks a real photo synchronously; cancelling a late duplicate still closes capture.
    if (!disabled) void workflow.receive(file);
    latest.current.onNativePending?.(false);
  }
  function choose(input: HTMLInputElement | null) { latest.current.onNativePending?.(true); input?.click(); }
  function complete(notice?: "attention") { setOpen(false); onComplete(notice); }
  async function explain(event: FormEvent) {
    event.preventDefault(); if (!reason.trim() || busy) return;
    setReporting(true); setReportError(false);
    try { await onCannotPhotograph(reason.trim(), missing.map((slot) => slot.slot)); complete("attention"); }
    catch { setReportError(true); }
    finally { setReporting(false); }
  }
  if (!current) return null;
  const currentPhoto = saved(current.slot), completed = slots.filter((slot) => state.accepted.includes(slot.slot)).length;
  const surface = <section ref={surfaceRef} className="camera-surface photo-workflow" aria-label={t("media.capture_title")}>
    <header className="photo-workflow-heading">
      <p className="photo-notice" role="status">{notice ? t("camera.scan_recorded") : ""}</p>
      <p className="photo-step">{t("camera.photo_step").replace("{step}", String(slots.indexOf(current) + 1)).replace("{total}", String(slots.length))} · {t(current.required ? "media.required" : "camera.optional")}</p>
      <h2 aria-live="polite" aria-atomic="true">{title(current)}</h2><p className="photo-guidance">{current.guidanceKa ?? t(`media.instruction.${current.slot}` as TranslationKey)}</p>
    </header>
    <div className="photo-capture-card" aria-busy={busy}>
      <div className="photo-guide" aria-hidden="true">{state.candidate || currentPhoto ? <Thumbnail blob={state.candidate ?? currentPhoto?.blob} label={t("media.last_photo")} /> :
        <svg viewBox="0 0 240 150"><rect x="20" y="10" width="200" height="130" rx="14" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="8 6" />{current.slot === "IDENTIFICATION" ? <><rect x="50" y="45" width="140" height="62" rx="6" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M66 62h90M66 77h110M66 92h60" stroke="currentColor" strokeWidth="4" /></> : <path d="M75 110V55l45-25 45 25v55l-45 25zM75 55l45 25 45-25M120 80v55" fill="none" stroke="currentColor" strokeWidth="3" />}</svg>}</div>
      {current.alreadyCovered ? <p className="photo-covered">{t("media.slot_already_covered")}</p> : null}
      {state.accepted.includes(current.slot) ? <p className="photo-retake-note">{t("camera.retake_keeps_original")}</p> : null}
      <button type="button" className="photo-open-camera" disabled={busy || disabled} onClick={() => choose(native.current)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 5l1-2h6l1 2h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /><circle cx="12" cy="13" r="4" /></svg> {t("camera.open_native")}</button>
      <p className="photo-save-status" role="status" aria-live="polite">{state.phase === "checking" ? t("media.checking_photo") : state.phase === "saving" ? t("camera.saving_photo") : state.failure ? "" : savedNotice ? t("camera.photo_saved_device") : t("camera.auto_save_hint")}</p>
      {state.failure ? <p role="alert">{t(state.failure === "storage" ? "camera.save_failed" : `media.error.${state.failure}` as TranslationKey)}</p> : null}
      {state.retryable ? <button type="button" disabled={busy || disabled} onClick={() => { void workflow.retry(); }}>{t("camera.retry_save")}</button> : null}
    </div>
    <input hidden ref={native} type="file" accept="image/jpeg" capture="environment" onChange={selected} aria-label={t("media.native_capture")} />
    <input hidden ref={picker} type="file" accept="image/jpeg,image/png,image/webp" onChange={selected} aria-label={t("media.pick_file")} />
    <footer className="photo-workflow-footer">
      <p className="photo-count">{t("camera.saved_count").replace("{done}", String(completed)).replace("{total}", String(slots.length))}</p>
      <ul className="photo-saved-list">{slots.filter((slot) => state.accepted.includes(slot.slot)).map((slot) => <li key={slot.slot}>
        <button type="button" className="photo-saved-row" disabled={busy} onClick={() => workflow.select(slot.slot)} aria-label={`${t("media.retake")}: ${title(slot)}`}>
          <span className="photo-thumbnail"><Thumbnail blob={saved(slot.slot)?.blob} label={title(slot)} /></span>
          <span><strong>{title(slot)}</strong><small>{status(slot.slot)}</small></span><span className="photo-retake-icon" aria-hidden="true">↻</span>
        </button></li>)}</ul>
      {slots.filter((slot) => !slot.required && !state.accepted.includes(slot.slot) && slot.slot !== current.slot).map((slot) => <button key={slot.slot} type="button" className="photo-optional" disabled={busy || disabled} onClick={() => workflow.select(slot.slot)}>+ {title(slot)} · {t("camera.optional")}</button>)}
      <button type="button" className="photo-gallery" disabled={busy || disabled} onClick={() => choose(picker.current)}>{t("camera.choose_gallery")}</button>
      {!current.required && missing.length ? <button type="button" disabled={busy} onClick={() => workflow.select(missing[0]!.slot)}>{t("media.skip_optional")}</button> : null}
      {!missing.length ? <button type="button" className="photo-finish" disabled={busy} onClick={() => complete()}>{t("media.finish_capture")}</button> : <>
        <p className="photo-remaining">{t("media.required_pending").replace("{count}", String(missing.length))}</p>
        <button type="button" className="photo-cannot" disabled={busy} onClick={() => setCannot(true)}>{t("media.cannot_photo")}</button>
      </>}
    </footer>
    {cannot ? <section className="camera-sheet"><button type="button" disabled={reporting} onClick={() => setCannot(false)}>{t("camera.return_photos")}</button><form onSubmit={explain}><label>{t("media.cannot_reason")}<textarea value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={4000} /></label><button type="submit" disabled={busy || !reason.trim()}>{t("media.save_reason")}</button>{reportError ? <p role="alert">{t("media.storage_error")}</p> : null}</form></section> : null}
  </section>;
  return parent ? surface : <><button type="button" onClick={() => setOpen(true)}>{t("camera.start_photos")}</button><CameraShell open={open} title={t("media.capture_title")} onClose={() => setOpen(false)} onStop={() => {}}>{surface}</CameraShell></>;
}

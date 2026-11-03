"use client";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { browserPhotoCamera, checkCapturedPhoto, PhotoCaptureError, type PhotoCamera, type PhotoCameraState } from "@khidi/media/capture-browser";
import type { CaptureSlot, PhotoSlot } from "@khidi/media/contracts";
import type { QualityConfig, QualityReport } from "@khidi/media/quality";
import { t, type TranslationKey } from "@khidi/i18n";
import "./media.css";

export function GuidedPhotoCapture({ slots, acceptedSlots, qualityConfig, disabled, onAccept, onCannotPhotograph, onComplete, onPhotoTaken, onNativePending }: {
  slots: CaptureSlot[]; acceptedSlots: PhotoSlot[]; qualityConfig: QualityConfig; disabled?: boolean;
  onAccept: (photo: { blob: Blob; slot: PhotoSlot; capturedAt: string; quality: QualityReport }) => Promise<void>;
  onCannotPhotograph: (reason: string, slots: PhotoSlot[]) => Promise<void>; onComplete: () => void;
  onPhotoTaken?: () => void; onNativePending?: (pending: boolean) => void;
}) {
  const [index, setIndex] = useState(0), [accepted, setAccepted] = useState(new Set(acceptedSlots));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null), [cannot, setCannot] = useState(false), [reason, setReason] = useState("");
  const [state, setState] = useState<PhotoCameraState>({ running: false, starting: false, width: 0, height: 0, issue: null });
  const native = useRef<HTMLInputElement>(null), picker = useRef<HTMLInputElement>(null), video = useRef<HTMLVideoElement>(null);
  const camera = useRef<PhotoCamera | null>(null), flight = useRef(false);
  const pendingCallback = useRef(onNativePending); pendingCallback.current = onNativePending;
  useEffect(() => {
    const inputs = [native.current, picker.current], cancel = () => pendingCallback.current?.(false);
    inputs.forEach((input) => input?.addEventListener("cancel", cancel));
    return () => inputs.forEach((input) => input?.removeEventListener("cancel", cancel));
  }, []);
  const acceptedKey = acceptedSlots.toSorted().join("|");
  useEffect(() => { setAccepted(new Set(acceptedKey.split("|").filter(Boolean) as PhotoSlot[])); }, [acceptedKey]);
  useEffect(() => { const controller = browserPhotoCamera(setState); camera.current = controller; return () => { controller.stop(); camera.current = null; }; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const current = slots[Math.min(index, slots.length - 1)];
  const missing = slots.filter((slot) => slot.required && !accepted.has(slot.slot));
  const lowResolution = state.running && Math.max(state.width, state.height) < qualityConfig.minLongEdge;
  async function accept(blob: Blob) {
    if (!current || disabled || flight.current) return;
    onPhotoTaken?.(); flight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const quality = await checkCapturedPhoto(blob, qualityConfig);
      const capturedAt = new Date().toISOString();
      setPreview(URL.createObjectURL(blob));
      await onAccept({ blob, slot: current.slot, capturedAt, quality });
      const nextAccepted = new Set(accepted); nextAccepted.add(current.slot); setAccepted(nextAccepted);
      setMessage(t("media.photo_accepted"));
      const next = slots.findIndex((slot) => slot.required && !nextAccepted.has(slot.slot));
      if (next >= 0) setIndex(next); else camera.current?.stop();
    } catch (failure) { setError(failure instanceof PhotoCaptureError ? t(`media.error.${failure.reason}` as TranslationKey) : t("media.storage_error")); }
    finally { flight.current = false; setBusy(false); }
  }
  function selected(event: ChangeEvent<HTMLInputElement>) { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void accept(file); onNativePending?.(false); }
  async function snapshot() {
    try { if (camera.current) await accept(await camera.current.capture(qualityConfig.minLongEdge)); }
    catch (failure) { setError(failure instanceof PhotoCaptureError ? t(`media.error.${failure.reason}` as TranslationKey) : t("scanner.camera_unavailable")); }
  }
  async function explain(event: FormEvent) {
    event.preventDefault(); if (!reason.trim() || busy) return;
    setBusy(true); setError("");
    try { await onCannotPhotograph(reason.trim(), missing.map((slot) => slot.slot)); camera.current?.stop(); onComplete(); }
    catch { setError(t("media.storage_error")); }
    finally { setBusy(false); }
  }
  if (!current) return null;
  return <section className="media-capture" aria-label={t("media.capture_title")}>
    <h2>{t("media.capture_title")}</h2>
    <ol className="media-slot-list">{slots.map((slot, i) => <li key={slot.slot}><button type="button" disabled={busy} aria-current={i === index ? "step" : undefined}
      onClick={() => { setIndex(i); setError(""); setMessage(""); }}>{accepted.has(slot.slot) ? "✓ " : ""}{slot.titleKa ?? t(`media.slot.${slot.slot}` as TranslationKey)}{slot.required ? ` · ${t("media.required")}` : ""}</button></li>)}</ol>
    <h3>{current.titleKa ?? t(`media.slot.${current.slot}` as TranslationKey)}</h3>
    <p>{current.guidanceKa ?? t(`media.instruction.${current.slot}` as TranslationKey)}</p>
    {current.alreadyCovered ? <p>{t("media.slot_already_covered")}</p> : null}
    {!current.required ? <button type="button" disabled={busy || disabled} onClick={() => {
      const next = slots.findIndex((slot) => slot.required && !accepted.has(slot.slot));
      if (next >= 0) setIndex(next); else { camera.current?.stop(); onComplete(); }
    }}>{t("media.skip_optional")}</button> : null}
    <div className="media-viewfinder">
      <video ref={video} playsInline muted aria-label={t("media.camera_preview")} hidden={!state.running} />
      {!state.running && preview ? <img src={preview} alt={t("media.last_photo")} /> : null}
      {!state.running && !preview ? <p>{t("media.frame_hint")}</p> : null}
      <div className={current.slot === "IDENTIFICATION" ? "media-frame media-identity-frame" : "media-frame"} aria-hidden="true" />
    </div>
    <input hidden ref={native} type="file" accept="image/jpeg" capture="environment" onChange={selected} aria-label={t("media.native_capture")} />
    <input hidden ref={picker} type="file" accept="image/jpeg,image/png,image/webp" onChange={selected} aria-label={t("media.pick_file")} />
    <div className="scanning-actions"><button type="button" disabled={busy || disabled} onClick={() => { camera.current?.stop(); onNativePending?.(true); native.current?.click(); }}>{t("media.native_capture")}</button>
      <button type="button" disabled={busy || disabled} onClick={() => { onNativePending?.(true); picker.current?.click(); }}>{t("media.pick_file")}</button></div>
    <div className="scanning-actions">{state.running || state.starting
      ? <><button type="button" disabled={busy || lowResolution || disabled || !state.running} onClick={() => { void snapshot(); }}>{t("media.take_photo")}</button><button type="button" onClick={() => camera.current?.stop()}>{t("scanner.camera_stop")}</button></>
      : <button type="button" disabled={busy || disabled} onClick={() => { if (video.current) void camera.current?.start(video.current); }}>{t("media.live_camera")}</button>}
    </div>
    {lowResolution ? <p role="status">{t("media.use_native_resolution")}</p> : null}
    {state.issue ? <p role="alert">{t(state.issue === "permission" ? "scanner.camera_permission" : "scanner.camera_unavailable")}</p> : null}
    <p role="status" aria-live="polite">{busy ? t("media.checking_photo") : message}</p>
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" className="media-next" disabled={busy || missing.length > 0} onClick={() => { camera.current?.stop(); onComplete(); }}>{t("media.finish_capture")}</button>
    {missing.length ? <><p>{t("media.required_pending").replace("{count}", String(missing.length))}</p>
      <button type="button" disabled={busy} onClick={() => setCannot(!cannot)}>{t("media.cannot_photo")}</button></> : null}
    {cannot ? <form onSubmit={explain}><label>{t("media.cannot_reason")}<textarea value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={4000} /></label>
      <button type="submit" disabled={busy || !reason.trim()}>{t("media.save_reason")}</button></form> : null}
  </section>;
}

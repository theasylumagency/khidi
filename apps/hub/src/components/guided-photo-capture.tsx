"use client";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { browserPhotoCamera, checkCapturedPhoto, PhotoCaptureError, type PhotoCamera, type PhotoCameraState } from "@khidi/media/capture-browser";
import type { CaptureSlot, PhotoSlot } from "@khidi/media/contracts";
import type { QualityConfig, QualityReport } from "@khidi/media/quality";
import { t, type TranslationKey } from "@khidi/i18n";
import { CameraShell, useParentCameraShell } from "./camera-shell.tsx";
import { containBounds } from "../lib/camera-shell.ts";

interface Candidate { blob: Blob; slot: PhotoSlot; capturedAt: string; quality: QualityReport | null }
export function GuidedPhotoCapture({ slots, acceptedSlots, qualityConfig, disabled, onAccept, onCannotPhotograph, onComplete, onPhotoTaken, onNativePending }: {
  slots: CaptureSlot[]; acceptedSlots: PhotoSlot[]; qualityConfig: QualityConfig; disabled?: boolean;
  onAccept: (photo: { blob: Blob; slot: PhotoSlot; capturedAt: string; quality: QualityReport }) => Promise<void>;
  onCannotPhotograph: (reason: string, slots: PhotoSlot[]) => Promise<void>; onComplete: () => void;
  onPhotoTaken?: () => void; onNativePending?: (pending: boolean) => void;
}) {
  const parent = useParentCameraShell(), [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0), [accepted, setAccepted] = useState(new Set(acceptedSlots));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null), [preview, setPreview] = useState("");
  const [cannot, setCannot] = useState(false), [reason, setReason] = useState("");
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [liveDimensions, setLiveDimensions] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState<ReturnType<typeof containBounds>>(null);
  const [state, setState] = useState<PhotoCameraState>({ running: false, starting: false, width: 0, height: 0, issue: null });
  const native = useRef<HTMLInputElement>(null), picker = useRef<HTMLInputElement>(null), video = useRef<HTMLVideoElement>(null), stage = useRef<HTMLDivElement>(null);
  const camera = useRef<PhotoCamera | null>(null), flight = useRef(false);
  const slotList = useRef<HTMLOListElement>(null);
  const pendingCallback = useRef(onNativePending); pendingCallback.current = onNativePending;
  useEffect(() => {
    const inputs = [native.current, picker.current], cancel = () => pendingCallback.current?.(false);
    inputs.forEach((input) => input?.addEventListener("cancel", cancel));
    return () => inputs.forEach((input) => input?.removeEventListener("cancel", cancel));
  }, []);
  const acceptedKey = acceptedSlots.toSorted().join("|");
  useEffect(() => { slotList.current?.querySelector<HTMLElement>('[aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "center" }); }, [index]);
  useEffect(() => { setAccepted(new Set(acceptedKey.split("|").filter(Boolean) as PhotoSlot[])); }, [acceptedKey]);
  useEffect(() => { const controller = browserPhotoCamera(setState); camera.current = controller; return () => { controller.stop(); camera.current = null; }; }, []);
  useEffect(() => parent?.registerStop(() => camera.current?.stop()), [parent]);
  useEffect(() => {
    const element = video.current; if (!element) return;
    const resized = () => setLiveDimensions({ width: element.videoWidth, height: element.videoHeight });
    element.addEventListener("resize", resized); return () => element.removeEventListener("resize", resized);
  }, []);
  useEffect(() => {
    if (!candidate) { setPreview(""); setDimensions({ width: 0, height: 0 }); return; }
    const url = URL.createObjectURL(candidate.blob); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [candidate?.blob]);
  const sourceWidth = state.running ? liveDimensions.width || state.width : dimensions.width, sourceHeight = state.running ? liveDimensions.height || state.height : dimensions.height;
  useEffect(() => {
    const element = stage.current; if (!element) return;
    const update = () => setBounds(containBounds(element.clientWidth, element.clientHeight, sourceWidth, sourceHeight));
    const observer = new ResizeObserver(update); observer.observe(element); update(); return () => observer.disconnect();
  }, [sourceWidth, sourceHeight, open]);
  const current = slots[Math.min(index, slots.length - 1)];
  const missing = slots.filter((slot) => slot.required && !accepted.has(slot.slot));
  const lowResolution = state.running && Math.max(sourceWidth, sourceHeight) < qualityConfig.minLongEdge;
  async function prepare(blob: Blob) {
    if (!current || disabled || flight.current) return;
    onPhotoTaken?.(); flight.current = true; setBusy(true); setError(""); setMessage(""); camera.current?.stop();
    const photo = { blob, slot: current.slot, capturedAt: new Date().toISOString(), quality: null };
    setCandidate(photo);
    try { const quality = await checkCapturedPhoto(blob, qualityConfig); setCandidate({ ...photo, quality }); }
    catch (failure) { setError(failure instanceof PhotoCaptureError ? t(`media.error.${failure.reason}` as TranslationKey) : t("media.storage_error")); }
    finally { flight.current = false; setBusy(false); }
  }
  async function accept() {
    if (!candidate?.quality || disabled || flight.current) return;
    flight.current = true; setBusy(true); setError("");
    try {
      await onAccept({ ...candidate, quality: candidate.quality });
      const nextAccepted = new Set(accepted); nextAccepted.add(candidate.slot); setAccepted(nextAccepted); setCandidate(null);
      setMessage(t("media.photo_accepted"));
      const next = slots.findIndex((slot) => slot.required && !nextAccepted.has(slot.slot));
      if (next >= 0) setIndex(next);
    } catch { setError(t("media.storage_error")); }
    finally { flight.current = false; setBusy(false); }
  }
  function selected(event: ChangeEvent<HTMLInputElement>) { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void prepare(file); onNativePending?.(false); }
  async function snapshot() {
    try { if (camera.current) await prepare(await camera.current.capture(qualityConfig.minLongEdge)); }
    catch (failure) { setError(failure instanceof PhotoCaptureError ? t(`media.error.${failure.reason}` as TranslationKey) : t("scanner.camera_unavailable")); }
  }
  function complete() { camera.current?.stop(); setOpen(false); onComplete(); }
  async function explain(event: FormEvent) {
    event.preventDefault(); if (!reason.trim() || busy) return;
    setBusy(true); setError("");
    try { await onCannotPhotograph(reason.trim(), missing.map((slot) => slot.slot)); complete(); }
    catch { setError(t("media.storage_error")); }
    finally { setBusy(false); }
  }
  if (!current) return null;
  const surface = <section className="camera-surface camera-photo" aria-label={t("media.capture_title")}>
    <header className="camera-photo-heading">
      <ol ref={slotList} className="camera-photo-slots">{slots.map((slot, i) => <li key={slot.slot}><button type="button" disabled={busy || !!candidate} aria-current={i === index ? "step" : undefined}
        onClick={() => { setIndex(i); setError(""); setMessage(""); }}>{accepted.has(slot.slot) ? "✓ " : ""}{slot.titleKa ?? t(`media.slot.${slot.slot}` as TranslationKey)}{slot.required ? " *" : ""}</button></li>)}</ol>
      <h3>{current.titleKa ?? t(`media.slot.${current.slot}` as TranslationKey)}</h3>
      <p>{current.guidanceKa ?? t(`media.instruction.${current.slot}` as TranslationKey)}</p>
    </header>
    <div ref={stage} className="camera-stage">
      <video ref={video} playsInline muted style={{ objectFit: "contain" }} aria-label={t("media.camera_preview")} hidden={!state.running} />
      {preview ? <img src={preview} alt={t("media.last_photo")} onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /> : null}
      {bounds && (state.running || preview) ? <div className="camera-photo-bounds" data-identity={current.slot === "IDENTIFICATION"} style={bounds} aria-hidden="true" /> : null}
      {!state.running && !preview ? <div className="camera-placeholder">
        <svg className="camera-guide" viewBox="0 0 240 180" aria-hidden="true"><rect x="12" y="12" width="216" height="156" rx="16" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="10 6" />{current.slot === "IDENTIFICATION" ? <><rect x="40" y="55" width="160" height="70" rx="6" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M60 75h100M60 92h120M60 109h65" stroke="currentColor" strokeWidth="4" /></> : <><path d="M65 135V70l55-30 55 30v65l-55 25zM65 70l55 30 55-30M120 100v60" fill="none" stroke="currentColor" strokeWidth="3" /></>}</svg>
        <p>{t("camera.native_guide")}</p>
      </div> : null}
    </div>
    <input hidden ref={native} type="file" accept="image/jpeg" capture="environment" onChange={selected} aria-label={t("media.native_capture")} />
    <input hidden ref={picker} type="file" accept="image/jpeg,image/png,image/webp" onChange={selected} aria-label={t("media.pick_file")} />
    <footer className="camera-footer">
      <p role="status" aria-live="polite">{busy ? t("media.checking_photo") : candidate?.quality ? t("camera.quality_passed") : message || t("camera.slot_progress").replace("{done}", String(slots.filter((slot) => slot.required && accepted.has(slot.slot)).length)).replace("{total}", String(slots.filter((slot) => slot.required).length))}</p>
      {error ? <p role="alert">{error}</p> : null}
      {state.issue ? <p role="alert">{t(state.issue === "permission" ? "scanner.camera_permission" : "scanner.camera_unavailable")}</p> : null}
      {lowResolution ? <p role="status">{t("media.use_native_resolution")}</p> : null}
      {current.alreadyCovered ? <p>{t("media.slot_already_covered")}</p> : null}
      {candidate ? <div className="camera-actions"><button type="button" disabled={busy} onClick={() => { setCandidate(null); setError(""); }}>{t("media.retake")}</button><button type="button" className="camera-primary" disabled={busy || disabled || !candidate.quality} onClick={() => { void accept(); }}>{t("camera.accept_photo")}</button></div> : <>
        <div className="camera-actions"><button type="button" disabled={busy || disabled} onClick={() => { onNativePending?.(true); picker.current?.click(); }}>{t("media.pick_file")}</button>
          <button type="button" className="camera-primary camera-shutter" aria-label={t("media.native_capture")} disabled={busy || disabled} onClick={() => { camera.current?.stop(); onNativePending?.(true); native.current?.click(); }}>●</button>
          {state.running || state.starting ? <button type="button" disabled={busy || lowResolution || disabled || !state.running} onClick={() => { void snapshot(); }}>{t("media.take_photo")}</button> : <button type="button" disabled={busy || disabled} onClick={() => { if (video.current) void camera.current?.start(video.current); }}>{t("media.live_camera")}</button>}
        </div>
        {!current.required ? <button type="button" disabled={busy || disabled} onClick={() => { const next = slots.findIndex((slot) => slot.required && !accepted.has(slot.slot)); if (next >= 0) setIndex(next); else complete(); }}>{t("media.skip_optional")}</button> : null}
        {!missing.length ? <button type="button" className="camera-primary" disabled={busy} onClick={complete}>{t("media.finish_capture")}</button> : <button type="button" disabled={busy} onClick={() => setCannot(true)}>{t("media.cannot_photo")}</button>}
      </>}
    </footer>
    {cannot ? <section className="camera-sheet"><button type="button" onClick={() => setCannot(false)}>{t("camera.return_photos")}</button><form onSubmit={explain}><label>{t("media.cannot_reason")}<textarea value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={4000} /></label><button type="submit" disabled={busy || !reason.trim()}>{t("media.save_reason")}</button></form></section> : null}
  </section>;
  return parent ? surface : <><button type="button" onClick={() => setOpen(true)}>{t("camera.start_photos")}</button><CameraShell open={open} title={t("media.capture_title")} onClose={() => setOpen(false)} onStop={() => camera.current?.stop()}>{surface}</CameraShell></>;
}

"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { browserCameraEnvironment, ScannerCamera, type CameraState } from "@khidi/scanning/camera";
import { t, type TranslationKey } from "@khidi/i18n";
import { useScanQueue } from "./scan-queue-provider.tsx";
import { PhotoWorkspace, type CaptureContext } from "./photo-workspace.tsx";
import type { PhotoTarget } from "@khidi/media/contracts";

interface ScannerTask { id: string; title: string; status: string; completedCount: number; targetCount: number | null; photosRequired?: boolean }
const INITIAL_CAMERA: CameraState = { running: false, starting: false, torchAvailable: false, torchOn: false, issue: null };

export function WarehouseScanner({ task }: { task?: ScannerTask }) {
  const queue = useScanQueue();
  const video = useRef<HTMLVideoElement>(null), field = useRef<HTMLInputElement>(null);
  const camera = useRef<ScannerCamera | null>(null), writing = useRef(false);
  const resumeCamera = useRef(false);
  const [cameraState, setCameraState] = useState(INITIAL_CAMERA);
  const [busy, setBusy] = useState(false), [accepted, setAccepted] = useState<string | null>(null), [error, setError] = useState("");
  const [progress, setProgress] = useState(task), [progressError, setProgressError] = useState(false);
  const [taskUnavailable, setTaskUnavailable] = useState(task ? !["OPEN", "IN_PROGRESS"].includes(task.status) : false);
  const [capture, setCapture] = useState<{ target: Partial<PhotoTarget>; onlyMissing: boolean } | null>(null), [duplicate, setDuplicate] = useState<Partial<PhotoTarget> | null>(null);
  const ready = queue.ready && !taskUnavailable && !capture;
  async function submit(value: string, noBarcode = false): Promise<boolean> {
    const scannedValue = value.trim();
    if (writing.current || !ready || (!scannedValue && !noBarcode)) return false;
    writing.current = true; setBusy(true); setError("");
    try {
      const duplicate = task && !noBarcode ? await queue.duplicate(task.id, scannedValue) : null;
      const key = await queue.enqueue({ sourceMode: task ? "TASK" : "QUICK_SCAN", taskId: task?.id ?? null, scannedValue, isNoBarcode: noBarcode });
      setAccepted(key); if (field.current) field.current.value = "";
      setDuplicate(duplicate ? duplicate.intakeId ? { intakeId: duplicate.intakeId } : { intakeIdempotencyKey: duplicate.intakeIdempotencyKey! } : null);
      if (task?.photosRequired && !duplicate) { resumeCamera.current = cameraState.running; camera.current?.stop(); setCapture({ target: { intakeIdempotencyKey: key }, onlyMissing: false }); }
      return true;
    } catch { setError(t("scanning.storage_error")); return false; }
    finally { writing.current = false; setBusy(false); }
  }
  const submitRef = useRef(submit); submitRef.current = submit;
  useEffect(() => {
    const controller = new ScannerCamera(browserCameraEnvironment(), (value) => submitRef.current(value), setCameraState);
    camera.current = controller;
    return () => { controller.stop(); camera.current = null; };
  }, []);
  useEffect(() => { if (!ready) camera.current?.stop(); }, [ready]);

  const taskId = task?.id, deliveryKey = queue.lastDelivery?.key;
  useEffect(() => {
    if (!taskId || !queue.ready) return;
    const cache = () => { void queue.cacheTask(taskId).catch(() => {}); };
    cache(); window.addEventListener("online", cache); window.addEventListener("focus", cache);
    return () => { window.removeEventListener("online", cache); window.removeEventListener("focus", cache); };
  }, [taskId, queue.ready]);
  useEffect(() => {
    if (!taskId) return;
    const abort = new AbortController();
    let fetching = false;
    async function refresh() {
      if (fetching) return;
      fetching = true;
      try {
        const response = await fetch(`/api/scanning/tasks/${taskId}`, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: abort.signal });
        if ([401, 403, 404].includes(response.status)) { setTaskUnavailable(true); return; }
        if (!response.ok) throw new Error("Progress unavailable.");
        const body = await response.json();
        if (body.id !== taskId || !Number.isInteger(body.completedCount) || !["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(body.status)) throw new Error("Invalid progress.");
        if (!abort.signal.aborted) {
          setProgress(body); setProgressError(false); setTaskUnavailable(!["OPEN", "IN_PROGRESS"].includes(body.status));
        }
      } catch { if (!abort.signal.aborted) setProgressError(true); }
      finally { fetching = false; }
    }
    const resume = () => { void refresh(); };
    resume(); window.addEventListener("online", resume); window.addEventListener("focus", resume);
    return () => { abort.abort(); window.removeEventListener("online", resume); window.removeEventListener("focus", resume); };
  }, [taskId, deliveryKey]);
  function onSubmit(event: FormEvent) { event.preventDefault(); void submit(field.current?.value ?? ""); }
  const review = accepted && queue.lastDelivery?.key === accepted && queue.lastDelivery.result.reviewReason;
  function finishCapture() {
    setCapture(null); setTimeout(() => { field.current?.focus(); if (resumeCamera.current && video.current && document.visibilityState === "visible") void camera.current?.start(video.current); resumeCamera.current = false; }, 0);
  }
  if (capture) return <PhotoWorkspace key={JSON.stringify(capture.target)} {...capture} onComplete={finishCapture} onDuplicate={(context: CaptureContext) => { finishCapture(); setDuplicate(context.target); }} />;
  return <div className="warehouse-scanner">
    {task ? <>
      <Link className="scanner-back" href="/warehouse/tasks">{t("scanner.back")}</Link><h1>{task.title}</h1>
      <p className="scanner-progress" aria-live="polite"><span>{t("scanning.progress")}</span> {progress?.completedCount ?? 0} / {progress?.targetCount ?? "—"}</p>
      <p className="scanner-hint">{t("scanner.progress_hint")}</p>
      {progressError ? <p role="status">{t("scanner.progress_unavailable")}</p> : null}
      {taskUnavailable ? <p role="alert">{t("scanner.task_unavailable")}</p> : null}
    </> : null}
    <section aria-label={t("scanner.camera")}>
      <div className="scanner-viewfinder" data-active={cameraState.running}>
        <video ref={video} playsInline muted aria-label={t("scanner.camera")} />
        {cameraState.running ? <div className="scanner-frame" aria-hidden="true" /> : <p>{t("scanner.camera_hint")}</p>}
      </div>
      <div className="scanning-actions">
        {cameraState.running || cameraState.starting
          ? <button type="button" onClick={() => camera.current?.stop()}>{t("scanner.camera_stop")}</button>
          : <button type="button" disabled={!ready} onClick={() => { if (video.current) void camera.current?.start(video.current); }}>{t(cameraState.issue ? "scanner.retry_camera" : "scanner.camera_start")}</button>}
        {cameraState.torchAvailable ? <button type="button" aria-pressed={cameraState.torchOn} onClick={() => { void camera.current?.toggleTorch(); }}>{t(cameraState.torchOn ? "scanner.torch_off" : "scanner.torch_on")}</button> : null}
      </div>
      {cameraState.starting ? <p role="status">{t("scanner.camera_starting")}</p> : null}
      {cameraState.issue ? <p role="alert">{t(`scanner.camera_${cameraState.issue}` as TranslationKey)}</p> : null}
    </section>
    <div className={review ? "scanner-received scanner-review" : "scanner-received"} role="status" aria-live="polite">
      {accepted ? <><strong>{t(review ? "scanning.review_recorded" : "warehouse.scan_accepted")}</strong><p>{t("warehouse.next_scan")}</p></> : <p>{t("scanner.camera_hint")}</p>}
    </div>
    {duplicate ? <section><p role="status">{t("media.already_scanned")}</p><button type="button" onClick={() => { camera.current?.stop(); setCapture({ target: duplicate, onlyMissing: true }); }}>{t("media.complete_photos")}</button></section> : null}
    <form onSubmit={onSubmit}>
      <label>{t("scanner.manual")}<input ref={field} maxLength={512} autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="send" /></label>
      <div className="scanning-actions"><button disabled={busy || !ready} type="submit">{t("scanning.accept")}</button>
        <button disabled={busy || !ready} type="button" onClick={() => { void submit("", true); }}>{t("scanning.no_barcode")}</button></div>
    </form>
    {error ? <p role="alert">{error}</p> : null}
    {!task?.photosRequired ? <p className="scanner-hint">{t("scanning.photos_pending")}</p> : null}
  </div>;
}

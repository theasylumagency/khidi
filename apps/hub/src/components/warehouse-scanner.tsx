"use client";
import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { browserCameraEnvironment, ScannerCamera, type CameraState } from "@khidi/scanning/camera";
import { t, type TranslationKey } from "@khidi/i18n";
import { useScanQueue } from "./scan-queue-provider.tsx";
import { PhotoWorkspace, type CaptureContext } from "./photo-workspace.tsx";
import type { PhotoTarget } from "@khidi/media/contracts";
import { CameraShell } from "./camera-shell.tsx";
import { cameraFlow, INITIAL_CAMERA_FLOW } from "../lib/camera-flow.ts";
import { scanFeedback } from "../lib/camera-shell.ts";
import { recordSessionActivity } from "../lib/session-client.ts";

interface ScannerTask { id: string; title: string; status: string; completedCount: number; targetCount: number | null; photosRequired?: boolean }
const INITIAL_CAMERA: CameraState = { running: false, starting: false, torchAvailable: false, torchOn: false, issue: null };

export function WarehouseScanner({ task }: { task?: ScannerTask }) {
  const queue = useScanQueue();
  const video = useRef<HTMLVideoElement>(null);
  const camera = useRef<ScannerCamera | null>(null), writing = useRef(false);
  const [flow, dispatch] = useReducer(cameraFlow, INITIAL_CAMERA_FLOW), capture = flow.photo;
  const [manualValue, setManualValue] = useState(""), [toast, setToast] = useState(false);
  const [attentionNotice, setAttentionNotice] = useState(false);
  useEffect(() => { if (!attentionNotice) return; const timer = setTimeout(() => setAttentionNotice(false), 3000); return () => clearTimeout(timer); }, [attentionNotice]);
  const feedbacks = useRef(new Map<string, string>());
  function feedback(key: string, result: "accepted" | "duplicate" | "review") {
    if (feedbacks.current.get(key) === result) return;
    feedbacks.current.set(key, result); scanFeedback(result, navigator);
    if (feedbacks.current.size > 100) feedbacks.current.delete(feedbacks.current.keys().next().value!);
  }
  const [cameraState, setCameraState] = useState(INITIAL_CAMERA);
  const [busy, setBusy] = useState(false), [accepted, setAccepted] = useState<string | null>(null), [error, setError] = useState("");
  const [progress, setProgress] = useState(task), [progressError, setProgressError] = useState(false);
  const [taskUnavailable, setTaskUnavailable] = useState(task ? !["OPEN", "IN_PROGRESS"].includes(task.status) : false);
  const [duplicate, setDuplicate] = useState<Partial<PhotoTarget> | null>(null);
  const [duplicateStatus, setDuplicateStatus] = useState<CaptureContext | null>(null);
  const duplicateKey = JSON.stringify(duplicate);
  useEffect(() => {
    setDuplicateStatus(null); if (!duplicateKey || duplicateKey === "null") return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(`/api/media/capture?${new URLSearchParams(JSON.parse(duplicateKey))}`, { cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal });
        if (response.ok) { const status = await response.json(); if (!controller.signal.aborted) setDuplicateStatus(status); }
      } catch { /* status is explicitly unknown offline */ }
    };
    void refresh(); window.addEventListener("online", refresh);
    return () => { controller.abort(); window.removeEventListener("online", refresh); };
  }, [duplicateKey, queue.photoVersion]);
  const ready = queue.ready && !taskUnavailable && !capture;
  async function submit(value: string, noBarcode = false): Promise<boolean> {
    const scannedValue = value.trim();
    if (writing.current || !ready || (!scannedValue && !noBarcode)) return false;
    writing.current = true; setBusy(true); setError("");
    try {
      const duplicate = task && !noBarcode ? await queue.duplicate(task.id, scannedValue) : null;
      const key = await queue.enqueue({ sourceMode: task ? "TASK" : "QUICK_SCAN", taskId: task?.id ?? null, scannedValue, isNoBarcode: noBarcode });
      recordSessionActivity();
      setAccepted(key); setManualValue(""); feedback(key, duplicate ? "duplicate" : "accepted"); dispatch({ type: "stored" });
      setDuplicate(duplicate ? duplicate.intakeId ? { intakeId: duplicate.intakeId } : { intakeIdempotencyKey: duplicate.intakeIdempotencyKey! } : null);
      if (task?.photosRequired && !duplicate) { camera.current?.stop(); dispatch({ type: "photos", photo: { target: { intakeIdempotencyKey: key }, onlyMissing: false, scanNotice: !noBarcode } }); }
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
  useEffect(() => {
    if (flow.open && ready && !flow.sheet && video.current && !document.hidden) void camera.current?.start(video.current);
    else camera.current?.stop();
    return () => camera.current?.stop();
  }, [flow.open, flow.sheet, ready]);

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
  function onSubmit(event: FormEvent) { event.preventDefault(); void submit(manualValue); }
  const review = accepted && queue.lastDelivery?.key === accepted && queue.lastDelivery.result.reviewReason;
  useEffect(() => {
    if (!accepted) return;
    setToast(true); const timer = setTimeout(() => setToast(false), 1800); return () => clearTimeout(timer);
  }, [accepted, review, duplicateKey]);
  useEffect(() => {
    const delivery = queue.lastDelivery;
    if (!delivery || !feedbacks.current.has(delivery.key)) return;
    if (delivery.result.reviewReason) feedback(delivery.key, "review");
    else if (delivery.result.duplicateOfIntakeId) feedback(delivery.key, "duplicate");
  }, [deliveryKey]);
  function finishCapture(notice?: "attention") {
    dispatch({ type: "photos-complete" });
    setAttentionNotice(notice === "attention");
  }
  const completeOriginal = () => { if (duplicate) { camera.current?.stop(); dispatch({ type: "photos", photo: { target: duplicate, onlyMissing: true } }); } };
  const manualForm = <form onSubmit={onSubmit}>
    <label>{t("scanner.manual")}<input value={manualValue} onChange={(event) => setManualValue(event.target.value)} maxLength={512} autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="send" autoFocus={flow.sheet === "manual"} /></label>
    <button disabled={busy || !ready} type="submit">{t("scanning.accept")}</button>
  </form>;
  return <div className="warehouse-scanner">
    {task ? <>
      <Link className="scanner-back" href="/warehouse/tasks">{t("scanner.back")}</Link><h1>{task.title}</h1>
      <p className="scanner-progress" aria-live="polite"><span>{t("scanning.progress")}</span> {progress?.completedCount ?? 0} / {progress?.targetCount ?? "—"}</p>
      <p className="scanner-hint">{t("scanner.progress_hint")}</p>
      {progressError ? <p role="status">{t("scanner.progress_unavailable")}</p> : null}
      {taskUnavailable ? <p role="alert">{t("scanner.task_unavailable")}</p> : null}
    </> : null}
    <button type="button" className="scanner-launch" disabled={!queue.ready || taskUnavailable && !capture} onClick={() => dispatch({ type: "open" })}>{t(capture ? "camera.resume_photos" : "scanner.camera_start")}</button>
    <CameraShell open={flow.open} title={capture ? t("media.capture_title") : task ? `${progress?.completedCount ?? 0} / ${progress?.targetCount ?? "—"}` : t("scanner.camera")} onClose={() => dispatch({ type: "close" })} onStop={() => camera.current?.stop()}>
      {capture ? <PhotoWorkspace key={JSON.stringify(capture.target)} {...capture} onComplete={finishCapture} onDuplicate={(context: CaptureContext) => { finishCapture(); setDuplicate(context.target); }} /> :
      <div className="camera-surface camera-scanner">
        <div className="camera-stage"><video ref={video} playsInline muted style={{ objectFit: "cover" }} aria-label={t("scanner.camera")} />
          {cameraState.running ? <div className="camera-target" aria-hidden="true" /> : <div className="camera-placeholder">
            <p role={cameraState.issue ? "alert" : "status"}>{t(cameraState.issue ? `scanner.camera_${cameraState.issue}` as TranslationKey : cameraState.starting ? "scanner.camera_starting" : "scanner.camera_hint")}</p>
            {!cameraState.starting ? <button type="button" disabled={!ready || !!flow.sheet} onClick={() => { if (video.current) void camera.current?.start(video.current); }}>{t("scanner.retry_camera")}</button> : null}
          </div>}
        </div>
        <div className="scanner-instructions"><strong>{t("camera.scanner_place")}</strong><p>{t("camera.scanner_auto")}</p></div>
        {cameraState.torchAvailable ? <div className="camera-toolbar"><button type="button" aria-pressed={cameraState.torchOn} aria-label={t(cameraState.torchOn ? "scanner.torch_off" : "scanner.torch_on")} onClick={() => { void camera.current?.toggleTorch(); }}>☀</button></div> : null}
        <footer className="camera-footer">
          <p className="camera-status" role="status" aria-live="polite">{attentionNotice ? t("camera.attention_saved") : toast ? t(review ? "scanning.review_recorded" : duplicate ? "media.already_scanned" : "warehouse.scan_accepted") : ""}</p>
          {duplicate ? <div className="camera-status"><p>{t(!duplicateStatus ? "media.photos_status_unknown" : duplicateStatus.missingSlots.length ? "media.required_photos_missing" : "media.photos_complete")}</p>{!duplicateStatus || duplicateStatus.missingSlots.length && duplicateStatus.canCompletePhotos ? <button type="button" onClick={completeOriginal}>{t("media.complete_photos")}</button> : null}</div> : null}
          {error ? <p role="alert">{error}</p> : null}
          <div className="camera-actions"><button type="button" onClick={() => dispatch({ type: "sheet", sheet: "manual" })}>{t("scanner.manual")}</button><button type="button" onClick={() => dispatch({ type: "sheet", sheet: "no-barcode" })}>{t("scanning.no_barcode")}</button></div>
        </footer>
        {flow.sheet ? <section className="camera-sheet" aria-label={t(flow.sheet === "manual" ? "scanner.manual" : "scanning.no_barcode")}>
          <button type="button" onClick={() => dispatch({ type: "sheet", sheet: null })}>{t("camera.return_scanner")}</button>
          {flow.sheet === "manual" ? manualForm : <><p>{t("camera.no_barcode_help")}</p><button type="button" className="camera-primary" disabled={busy || !ready} onClick={() => { void submit("", true); }}>{t("scanning.no_barcode")}</button></>}
          {error ? <p role="alert">{error}</p> : null}
        </section> : null}
      </div>}
    </CameraShell>
    <div className={review ? "scanner-received scanner-review" : "scanner-received"} role="status" aria-live="polite">
      {accepted ? <><strong>{t(review ? "scanning.review_recorded" : "warehouse.scan_accepted")}</strong><p>{t("warehouse.next_scan")}</p></> : <p>{t("scanner.camera_hint")}</p>}
    </div>
    {!flow.open ? <>{duplicate ? <section><p>{t("media.already_scanned")}</p><p>{t(!duplicateStatus ? "media.photos_status_unknown" : duplicateStatus.missingSlots.length ? "media.required_photos_missing" : "media.photos_complete")}</p>{!duplicateStatus || duplicateStatus.missingSlots.length && duplicateStatus.canCompletePhotos ? <button type="button" onClick={completeOriginal}>{t("media.complete_photos")}</button> : null}</section> : null}{manualForm}<button disabled={busy || !ready} type="button" onClick={() => { void submit("", true); }}>{t("scanning.no_barcode")}</button></> : null}
    {error ? <p role="alert">{error}</p> : null}
    {!task?.photosRequired ? <p className="scanner-hint">{t("scanning.photos_pending")}</p> : null}
  </div>;
}

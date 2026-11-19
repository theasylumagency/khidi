"use client";

import { useRef, useState, useTransition, type FormEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import type { getReviewProduct } from "@khidi/catalog-review";
import { t, type TranslationKey } from "@khidi/i18n";

type Activity = Awaited<ReturnType<typeof getReviewProduct>>["photoWork"];
type Row = Activity[number]["event"];
type Photo = { id: string; position: number; url: string };
const models = { local: "review.local", "gemini-3.1-flash-image": "review.fast", "gemini-3-pro-image": "review.pro" } as const;
const date = new Intl.DateTimeFormat("ka-GE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tbilisi" });
const url = (product: string, photo: string) => "/api/catalog-review/photo/" + product + "/" + photo;

function usePhotoAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [message, setMessage] = useState<TranslationKey>();
  const inFlight = useRef(false);
  const key = useRef({ identity: "", value: "", file: null as File | null });
  async function submit(body: FormData | Record<string, unknown>, onSuccess?: () => void) {
    if (inFlight.current || refreshing) return;
    inFlight.current = true;
    const multipart = body instanceof FormData;
    const identity = multipart ? JSON.stringify([...body.entries()].filter(([name]) => name !== "image")) : JSON.stringify(body);
    const file = multipart ? body.get("image") as File : null;
    if (key.current.identity !== identity || file !== key.current.file) key.current = { identity, file, value: crypto.randomUUID() };
    setBusy(true);
    setMessage("review.working_photo");
    try {
      const response = await fetch("/api/catalog-review/photo-work", { method: "POST",
        headers: { "Idempotency-Key": key.current.value, ...(multipart ? {} : { "Content-Type": "application/json" }) },
        body: multipart ? body : JSON.stringify(body) });
      if (!response.ok) {
        if (response.status === 422) key.current.identity = "";
        const errors: Record<number, TranslationKey> = { 400: multipart ? "review.image_invalid" : "review.failed", 401: "review.expired",
          409: "review.conflict", 412: "review.paid_limit", 413: "review.image_invalid", 422: "review.render_failed" };
        setMessage(errors[response.status] ?? "review.failed");
      } else {
        key.current.identity = "";
        onSuccess?.();
        setMessage("review.saved");
      }
      startTransition(() => router.refresh());
    } catch { setMessage("review.failed"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return { busy: busy || refreshing, submit, feedback: <p role="status" className="review-feedback">{message ? t(message) : null}</p> };
}

export function ReviewPhotoHistory({ activity }: { activity: Activity }) {
  if (!activity.length) return null;
  return <details className="photo-history"><summary>{t("review.photo_activity")} ({activity.length})</summary>
    <ol>{activity.slice().reverse().map(({ event, actor }) => <li key={event.id}>
      <strong>{t(`review.operation.${event.kind}`)}</strong> · {actor} · {date.format(new Date(event.createdAt))}
      {event.detail && <span> · {event.detail}</span>}
      {event.mode && <span> · {t(`review.${event.mode}`)}</span>}
      {event.model && <span> · {t(models[event.model])}</span>}
      {event.placement && <span> · X {event.placement.x}% · Y {event.placement.y}% · {t("review.size")} {event.placement.size}%</span>}
    </li>)}</ol></details>;
}

function DetailRequest({ productId, request, events, paid }: { productId: string; request: Row; events: Row[]; paid: boolean }) {
  const renders = events.filter(e => e.kind === "RENDER" && e.parentId === request.id);
  const previews = events.filter(e => e.kind === "PREVIEW" && renders.some(r => r.id === e.parentId));
  const accepted = events.find(e => e.kind === "ACCEPT" && e.parentId === request.id);
  const latest = renders.at(-1);
  const [p, place] = useState(latest?.placement ?? request.placement!);
  const [model, setModel] = useState<keyof typeof models>(paid && request.mode === "MOUNT" ? "gemini-3.1-flash-image" : "local");
  const sending = usePhotoAction();
  const left = (100 - p.size) * p.x / 100;
  const top = (100 - p.size) * p.y / 100;
  function moveDetail(e: PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const offset = (point: number, start: number, length: number) => Math.max(0, Math.min(100,
      Math.round(((point - start) / length * 100 - p.size / 2) * 100 / (100 - p.size))));
    place({ ...p, x: offset(e.clientX,box.left,box.width), y: offset(e.clientY,box.top,box.height) });
  }
  return <section className="review-detail-request">
    <h3>{request.detail} · {t(`review.${request.mode!}`)}</h3>
    {accepted ? <p>{t("review.approved_photo")}</p> : <fieldset disabled={sending.busy}>
      <legend>{t("review.layout")}</legend>
      <div className="review-edit-canvas" onPointerDown={e => {
        if (sending.busy || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        moveDetail(e);
      }} onPointerMove={e => {
        if (!sending.busy && e.currentTarget.hasPointerCapture(e.pointerId)) moveDetail(e);
      }}>
        <img src={url(productId,request.basePhotoId!)} alt={t("review.base")} />
        <img className="review-detail-layer" data-mode={request.mode} src={url(productId,request.photoId!)} alt={request.detail!}
          style={{ left: left + "%", top: top + "%", width: p.size + "%", height: p.size + "%" }} />
      </div>
      <small>{t("review.move_detail")}</small>
      {(["x","y","size"] as const).map(axis => <label key={axis}>{t(`review.${axis}`)} · {p[axis]}%
        <input type="range" min={axis === "size" ? 10 : 0} max={axis === "size" ? 70 : 100}
          value={p[axis]} onChange={e => place({ ...p, [axis]: Number(e.currentTarget.value) })} />
      </label>)}
      <button type="button" onClick={() => place(request.placement!)}>{t("review.reset_layout")}</button>
      {request.mode === "MOUNT" && <><label>{t("review.method")}
        <select value={model} onChange={e => setModel(e.target.value as keyof typeof models)}>
          {Object.entries(models).map(([m,label]) => <option key={m} disabled={!paid && m !== "local"} value={m}>{t(label)}</option>)}
        </select></label><small>{t(paid ? "review.ai_hint" : "review.paid_unavailable")}</small>
        {model !== "local" && <small>{t("review.paid_info")}</small>}</>}
      <button type="button" onClick={() => sending.submit({ productId, requestId: request.id, placement: p, model })}>
        {t(model === "local" ? "review.render" : "review.render_paid")}</button>
    </fieldset>}
    {previews.length > 0 && <div className="review-edit-previews"><h4>{t("review.previews")}</h4>
      {previews.slice().reverse().map(e => <figure key={e.id}>
        <img src={url(productId,e.photoId!)} alt={request.detail!} />
        <figcaption>{t(models[renders.find(r => r.id === e.parentId)!.model!])}</figcaption>
        {accepted?.photoId === e.photoId && <strong>{t("review.approved_photo")}</strong>}
        {!accepted && <button type="button" disabled={sending.busy}
          onClick={() => sending.submit({ productId, previewId: e.id })}>{t("review.accept_draft")}</button>}
      </figure>)}</div>}
    {sending.feedback}
  </section>;
}

export function ReviewPhotoStudio({ productId, photos, activity, paid }: {
  productId: string; photos: Photo[]; activity: Activity; paid: boolean;
}) {
  const [kind, setKind] = useState("UPLOAD");
  const [base, setBase] = useState(photos[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const sending = usePhotoAction();
  const events = activity.map(row => row.event);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    data.set("productId",productId);
    data.set("kind",kind);
    data.set("image",file);
    void sending.submit(data, () => { form.reset(); setFile(null); });
  }
  return <section className="review-photo-studio"><h2>{t("review.studio")}</h2>
    <form onSubmit={submit}><fieldset disabled={sending.busy}>
      <div className="review-actions">{(["UPLOAD","REQUEST"] as const).map(k =>
        <button type="button" aria-pressed={k === kind} key={k} onClick={() => setKind(k)}>
          {t(k === "UPLOAD" ? "review.upload" : "review.request_detail")}</button>)}</div>
      {kind === "REQUEST" && photos.length > 0 && <>
        <label>{t("review.base")}<select name="basePhotoId" value={base || photos[0]!.id} onChange={e => setBase(e.target.value)}>
          {photos.map(photo => <option key={photo.id} value={photo.id}>{t("review.photo")} {photo.position}</option>)}</select></label>
        <img className="review-base-thumb" src={url(productId,base || photos[0]!.id)} alt={t("review.base")} />
        <label>{t("review.detail")}<input name="detail" maxLength={240} required placeholder={t("review.detail_hint")} /></label>
        <label>{t("review.presentation")}<select name="mode"><option value="INSET">{t("review.INSET")}</option>
          <option value="MOUNT">{t("review.MOUNT")}</option></select></label></>}
      {kind === "REQUEST" && !photos.length ? <p>{t("review.add_base_first")}</p> : <>
        <label>{t(kind === "UPLOAD" ? "review.upload" : "review.source_image")}
          <input type="file" required accept="image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <small>{t("review.file_help")}</small></label>
        <button type="submit" disabled={!file || file.size > 15 * 1024 * 1024}>{t(kind === "UPLOAD" ? "review.upload_save" : "review.layout_suggest")}</button>
        {file && file.size > 15 * 1024 * 1024 && <small role="alert">{t("review.image_invalid")}</small>}</>}
    </fieldset>{sending.feedback}</form>
    {events.filter(e => e.kind === "REQUEST").reverse().map(request =>
      <DetailRequest key={request.id} productId={productId} request={request} events={events} paid={paid} />)}
    <ReviewPhotoHistory activity={activity} />
  </section>;
}

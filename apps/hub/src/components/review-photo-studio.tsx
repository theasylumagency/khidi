"use client";

import { useRef, useState, useTransition, type FormEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import type { getReviewProduct } from "@khidi/catalog-review";
import type { ReviewAdjustment, ReviewImageModel, ReviewPhotoMode, ReviewPlacement } from "@khidi/db";
import { t, type TranslationKey } from "@khidi/i18n";
import { useLightbox, type LightboxImage } from "./photo-lightbox.tsx";

type Activity = Awaited<ReturnType<typeof getReviewProduct>>["photoWork"];
type Row = Activity[number]["event"];
type Photo = { id: string; position: number; url: string };
type Action = "UPLOAD" | "ADJUST" | "CLEAN" | "BACKGROUND" | "DETAIL" | "SCENE";
const actions: Action[] = ["UPLOAD", "ADJUST", "CLEAN", "BACKGROUND", "DETAIL", "SCENE"];
const aiModels: ReviewImageModel[] = ["gpt-image-2.6-sunburst", "gemini-3-pro-image", "gpt-image-2.6-flare", "gemini-3.1-flash-image"];
const date = new Intl.DateTimeFormat("ka-GE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tbilisi" });
const url = (product: string, photo: string) => "/api/catalog-review/photo/" + product + "/" + photo;
const boxed = (mode: ReviewPhotoMode) => mode === "INSET" || mode === "MOUNT" || mode === "CLEAN";
const methodsFor = (mode: ReviewPhotoMode, ready: ReviewImageModel[]): ReviewImageModel[] =>
  mode === "ADJUST" || mode === "INSET" ? ["local"]
    : [...(mode === "MOUNT" ? ["local" as const] : []), ...aiModels.filter(m => ready.includes(m))];
const errors: Record<number, TranslationKey> = { 400: "review.failed", 401: "review.expired", 409: "review.conflict",
  412: "review.paid_limit", 413: "review.image_invalid", 422: "review.render_failed" };

/** Posts photo operations. Each distinct operation keeps its retry key until it succeeds, so a retry is never billed twice. */
function usePhotoAction() {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [refreshing, startTransition] = useTransition();
  const [message, setMessage] = useState<TranslationKey>();
  const keys = useRef(new Map<string, string>());
  async function submit(body: FormData | Record<string, unknown>, onSuccess?: () => void) {
    const multipart = body instanceof FormData;
    const file = multipart ? body.get("image") as File : null;
    const identity = (multipart ? JSON.stringify([...body.entries()].filter(([n]) => n !== "image")) : JSON.stringify(body))
      + (file ? file.name + file.size + file.lastModified : "");
    if (!keys.current.has(identity)) keys.current.set(identity, crypto.randomUUID());
    setPending(n => n + 1); setMessage("review.working_photo");
    try {
      const response = await fetch("/api/catalog-review/photo-work", { method: "POST",
        headers: { "Idempotency-Key": keys.current.get(identity)!, ...(multipart ? {} : { "Content-Type": "application/json" }) },
        body: multipart ? body : JSON.stringify(body) });
      if (response.ok || response.status === 422) keys.current.delete(identity);
      if (!response.ok) setMessage(multipart && response.status === 400 ? "review.image_invalid" : errors[response.status] ?? "review.failed");
      else { onSuccess?.(); setMessage("review.saved"); }
      startTransition(() => router.refresh());
    } catch { setMessage("review.failed"); }
    finally { setPending(n => n - 1); }
  }
  return { busy: pending > 0 || refreshing, waiting: pending > 0, submit,
    feedback: <p role="status" className="review-feedback">{message ? t(message) : null}</p> };
}

export function ReviewPhotoHistory({ activity }: { activity: Activity }) {
  if (!activity.length) return null;
  return <details className="photo-history"><summary>{t("review.photo_activity")} ({activity.length})</summary>
    <ol>{activity.slice().reverse().map(({ event, actor }) => <li key={event.id}>
      <strong>{t(`review.operation.${event.kind}`)}</strong> · {actor} · {date.format(new Date(event.createdAt))}
      {event.detail && <span> · {event.detail}</span>}
      {event.mode && <span> · {t(`review.${event.mode}`)}</span>}
      {event.model && <span> · {t(`studio.model.${event.model}`)}</span>}
      {event.note && <span> · {event.note}</span>}
      {event.placement && <span> · X {event.placement.x}% · Y {event.placement.y}% · {t("review.size")} {event.placement.size}%</span>}
    </li>)}</ol></details>;
}

function AreaPicker({ productId, request, value, onChange, disabled }: {
  productId: string; request: Row; value: ReviewPlacement; onChange: (p: ReviewPlacement) => void; disabled: boolean;
}) {
  const left = (100 - value.size) * value.x / 100, top = (100 - value.size) * value.y / 100;
  function move(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const at = (point: number, start: number, length: number) => Math.max(0, Math.min(100,
      Math.round(((point - start) / length * 100 - value.size / 2) * 100 / (100 - value.size))));
    onChange({ ...value, x: at(e.clientX, r.left, r.width), y: at(e.clientY, r.top, r.height) });
  }
  const style = { left: left + "%", top: top + "%", width: value.size + "%", height: value.size + "%" };
  return <>
    <div className="review-edit-canvas" onPointerDown={e => {
      if (disabled || e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId); move(e);
    }} onPointerMove={e => { if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) move(e); }}>
      <img src={url(productId, request.basePhotoId!)} alt={t("review.base")}/>
      {request.photoId ? <img className="review-detail-layer" data-mode={request.mode} src={url(productId, request.photoId)}
        alt={request.detail ?? ""} style={style}/> : <span className="studio-area" style={style}/>}
    </div>
    <small>{t(request.photoId ? "review.move_detail" : "studio.area")}</small>
    {(["x", "y", "size"] as const).map(axis => <label key={axis}>{t(axis === "size" && !request.photoId ? "studio.area_size" : `review.${axis}`)} · {value[axis]}%
      <input type="range" min={axis === "size" ? 10 : 0} max={axis === "size" ? 70 : 100} value={value[axis]}
        onChange={e => onChange({ ...value, [axis]: Number(e.currentTarget.value) })}/></label>)}
    <button type="button" onClick={() => onChange(request.placement!)}>{t("review.reset_layout")}</button>
  </>;
}

function Preview({ productId, mode, preview, render, accepted, rejected, onDone, sending, onOpen }: {
  productId: string; mode: ReviewPhotoMode; preview: Row; render: Row; accepted?: Row; rejected?: Row; onDone: boolean; onOpen: () => void;
  sending: ReturnType<typeof usePhotoAction>;
}) {
  const [reason, setReason] = useState(""), [asking, setAsking] = useState(false);
  // Same rule as the stored origin: an adjustment is a photo, a clean-up or background an AI edit, the rest illustrations.
  const label = mode === "ADJUST" ? null : mode === "CLEAN" || mode === "BACKGROUND" ? "store.kind.AI_EDIT" as const : "studio.illustration" as const;
  const mine = accepted?.photoId === preview.photoId;
  return <figure data-state={mine ? "accepted" : rejected ? "rejected" : "open"}>
    <button type="button" className="studio-open" aria-label={t("lightbox.zoom")} onClick={onOpen}><img src={url(productId, preview.photoId!)} alt=""/></button>
    <figcaption>{t(`studio.model.${render.model!}`)}{label && <em> · {t(label)}</em>}</figcaption>
    {mine && <strong>{t("review.approved_photo")}</strong>}
    {rejected && <p className="studio-rejected">{t("studio.rejected")} · {rejected.note}</p>}
    {!onDone && !rejected && <div className="studio-verdict">
      <button type="button" className="studio-accept" disabled={sending.busy} onClick={() => sending.submit({ productId, previewId: preview.id })}>{t("studio.accept")}</button>
      {asking ? <><input maxLength={600} value={reason} aria-label={t("studio.reject_reason")} placeholder={t("studio.reject_reason")}
        onChange={e => setReason(e.target.value)}/>
        <button type="button" disabled={sending.busy || !reason.trim()} onClick={() => sending.submit({ productId, previewId: preview.id, note: reason.trim() })}>
          {t("studio.reject_save")}</button></>
        : <button type="button" onClick={() => setAsking(true)}>{t("studio.reject")}</button>}
    </div>}
  </figure>;
}

function EditRequest({ productId, request, events, ready }: { productId: string; request: Row; events: Row[]; ready: ReviewImageModel[] }) {
  const mode = request.mode!;
  const renders = events.filter(e => e.kind === "RENDER" && e.parentId === request.id);
  const previews = events.filter(e => e.kind === "PREVIEW" && renders.some(r => r.id === e.parentId));
  const failed = events.filter(e => e.kind === "FAILED" && renders.some(r => r.id === e.parentId)).length;
  const accepted = events.find(e => e.kind === "ACCEPT" && e.parentId === request.id);
  const methods = methodsFor(mode, ready);
  const latest = renders.at(-1);
  const [p, place] = useState<ReviewPlacement | null>(latest?.placement ?? request.placement);
  const [settings, setSettings] = useState<ReviewAdjustment>(latest?.settings ?? { rotate: 0, tone: true, trim: true });
  const [chosen, choose] = useState<ReviewImageModel[]>(() => {
    const ai = methods.filter(m => m !== "local");
    return mode === "MOUNT" && !ai.length || !ai.length ? methods.slice(0, 1) : ai.slice(0, 2);
  });
  const sending = usePhotoAction();
  const ai = methods.some(m => m !== "local");
  // The viewer starts with the original so every version can be compared with what was photographed.
  const viewer = useLightbox(), shown = previews.slice().reverse();
  const gallery: LightboxImage[] = [{ url: url(productId, request.basePhotoId!), caption: t("lightbox.original") },
    ...shown.map(e => ({ url: url(productId, e.photoId!), caption: t(`studio.model.${renders.find(r => r.id === e.parentId)!.model!}`) }))];
  function make() {
    for (const model of chosen) void sending.submit({ productId, requestId: request.id, model,
      ...(boxed(mode) ? { placement: p } : {}), ...(mode === "ADJUST" ? { settings } : {}) });
  }
  const toggle = (m: ReviewImageModel) => choose(c => c.includes(m) ? c.filter(x => x !== m) : [...c, m].slice(-2));
  return <section className="review-detail-request">
    <h3>{t(`review.${mode}`)}{request.detail ? " · " + request.detail : ""}</h3>
    {!accepted && <fieldset disabled={sending.busy}>
      {boxed(mode) && p && <AreaPicker productId={productId} request={request} value={p} onChange={place} disabled={sending.busy}/>}
      {!boxed(mode) && <button type="button" className="studio-open studio-base-open" aria-label={t("lightbox.zoom") + ": " + t("lightbox.original")}
        onClick={() => viewer.open(gallery, 0)}><img className="review-base-thumb" src={url(productId, request.basePhotoId!)} alt={t("review.base")}/></button>}
      {mode === "ADJUST" && <div className="studio-adjust">
        <button type="button" onClick={() => setSettings(s => ({ ...s, rotate: (s.rotate + 90) % 360 as ReviewAdjustment["rotate"] }))}>
          {t("studio.rotate")} · {settings.rotate}°</button>
        <label className="studio-check"><input type="checkbox" checked={settings.trim} onChange={e => setSettings(s => ({ ...s, trim: e.target.checked }))}/>{t("studio.trim")}</label>
        <label className="studio-check"><input type="checkbox" checked={settings.tone} onChange={e => setSettings(s => ({ ...s, tone: e.target.checked }))}/>{t("studio.tone")}</label>
      </div>}
      {methods.length > 1 && <div className="studio-methods" role="group" aria-label={t("studio.methods")}><span>{t("studio.methods")}</span>
        {methods.map(m => <label key={m} className="studio-check"><input type="checkbox" checked={chosen.includes(m)} onChange={() => toggle(m)}/>{t(`studio.model.${m}`)}</label>)}</div>}
      {!methods.length && <p>{t("studio.no_ai")}</p>}
      {ai && <small>{t(mode === "CLEAN" || mode === "BACKGROUND" ? "studio.ai_note.edit" : "studio.ai_note.illustration")}</small>}
      <button type="button" className="studio-make" disabled={!chosen.length || !methods.length} onClick={make}>
        {t(chosen.length > 1 ? "studio.compare" : "studio.make")}</button>
      {sending.waiting && chosen.some(m => m !== "local") && <small>{t("studio.waiting")}</small>}
    </fieldset>}
    {failed > 0 && <small>{t("review.render_failed")} ({failed})</small>}
    {previews.length > 0 && <div className="review-edit-previews"><h4>{t("review.previews")}</h4>
      {shown.map((e, i) => <Preview key={e.id} productId={productId} mode={mode} preview={e} sending={sending} onDone={Boolean(accepted)}
        onOpen={() => viewer.open(gallery, i + 1)}
        render={renders.find(r => r.id === e.parentId)!} accepted={accepted}
        rejected={events.find(x => x.kind === "REJECT" && x.parentId === e.id)}/>)}</div>}
    {sending.feedback}{viewer.node}
  </section>;
}

export function ReviewPhotoStudio({ productId, photos, activity, ready }: {
  productId: string; photos: Photo[]; activity: Activity; ready: ReviewImageModel[];
}) {
  const [action, setAction] = useState<Action>("UPLOAD");
  const [base, setBase] = useState(photos[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const sending = usePhotoAction(), viewer = useLightbox();
  const events = activity.map(row => row.event);
  const needsBase = action !== "UPLOAD", basePhoto = base || photos[0]?.id;
  const aiOnly = action === "CLEAN" || action === "BACKGROUND" || action === "SCENE";
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (action === "UPLOAD" || action === "DETAIL") {
      if (!file) return;
      const form = e.currentTarget, data = new FormData(form);
      data.set("productId", productId);
      data.set("kind", action === "UPLOAD" ? "UPLOAD" : "REQUEST");
      if (action === "UPLOAD") { data.delete("basePhotoId"); data.delete("detail"); data.delete("mode"); }
      data.set("image", file);
      void sending.submit(data, () => { form.reset(); setFile(null); });
    } else {
      void sending.submit({ productId, basePhotoId: basePhoto, mode: action, ...(note.trim() ? { detail: note.trim() } : {}) },
        () => setNote(""));
    }
  }
  const requests = events.filter(e => e.kind === "REQUEST").reverse();
  const open = requests.filter(r => !events.some(e => e.kind === "ACCEPT" && e.parentId === r.id));
  const done = requests.filter(r => !open.includes(r));
  return <section className="review-photo-studio"><h2>{t("studio.title")}</h2>
    <div className="studio-actions" role="tablist">{actions.map(a => <button type="button" role="tab" aria-selected={a === action} key={a}
      onClick={() => { setAction(a); setNote(""); }}>{t(`studio.action.${a}`)}
      {a !== "UPLOAD" && <small data-tag={a === "ADJUST" ? "free" : "ai"}>{t(a === "ADJUST" ? "studio.tag.free" : "studio.tag.ai")}</small>}</button>)}</div>
    <form onSubmit={submit}><fieldset disabled={sending.busy}>
      <p className="studio-help">{t(`studio.help.${action}`)}</p>
      {needsBase && (photos.length ? <div className="studio-bases" role="radiogroup" aria-label={t("studio.base")}><span>{t("studio.base")}</span>
        {photos.map((photo, i) => <span className="studio-base" key={photo.id}>
          <button type="button" role="radio" aria-checked={photo.id === basePhoto} onClick={() => setBase(photo.id)}>
            <img src={photo.url} alt={t("review.photo") + " " + photo.position} width={96} height={96}/></button>
          <button type="button" className="studio-zoom" aria-label={t("lightbox.zoom") + ": " + t("review.photo") + " " + photo.position}
            onClick={() => viewer.open(photos.map(p => ({ url: p.url, caption: t("review.photo") + " " + p.position })), i)}>🔍</button></span>)}
        <input type="hidden" name="basePhotoId" value={basePhoto ?? ""}/></div> : <p>{t("review.add_base_first")}</p>)}
      {action === "DETAIL" && <>
        <label>{t("review.detail")}<input name="detail" maxLength={240} required placeholder={t("review.detail_hint")}/></label>
        <label>{t("review.presentation")}<select name="mode"><option value="MOUNT">{t("review.MOUNT")}</option>
          <option value="INSET">{t("review.INSET")}</option></select></label></>}
      {(action === "CLEAN" || action === "SCENE") && <label>{t(action === "CLEAN" ? "studio.clean_label" : "studio.scene_label")}
        <input maxLength={240} required value={note} placeholder={t(action === "CLEAN" ? "studio.clean_hint" : "studio.scene_hint")}
          onChange={e => setNote(e.target.value)}/></label>}
      {(action === "UPLOAD" || action === "DETAIL") && <label>{t(action === "UPLOAD" ? "review.upload" : "review.source_image")}
        <input type="file" required accept="image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)}/>
        <small>{t("review.file_help")}</small></label>}
      {aiOnly && !ready.length && <p>{t("studio.no_ai")}</p>}
      <button type="submit" className="studio-make" disabled={needsBase && !photos.length || aiOnly && !ready.length
        || (action === "UPLOAD" || action === "DETAIL") && (!file || file.size > 15 * 1024 * 1024)}>
        {t(action === "UPLOAD" ? "review.upload_save" : action === "DETAIL" ? "review.layout_suggest" : "studio.start")}</button>
      {file && file.size > 15 * 1024 * 1024 && <small role="alert">{t("review.image_invalid")}</small>}
    </fieldset>{sending.feedback}</form>
    {open.map(r => <EditRequest key={r.id} productId={productId} request={r} events={events} ready={ready}/>)}
    {done.length > 0 && <details><summary>{t("studio.done")} ({done.length})</summary>
      {done.map(r => <EditRequest key={r.id} productId={productId} request={r} events={events} ready={ready}/>)}</details>}
    <ReviewPhotoHistory activity={activity}/>{viewer.node}
  </section>;
}

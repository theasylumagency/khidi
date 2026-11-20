"use client";

import { useRef, useState, useTransition, type FormEvent, type PointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { getReviewProduct } from "@khidi/catalog-review";
import type { ReviewAdjustment, ReviewImageModel, ReviewPhotoMode, ReviewPlacement } from "@khidi/db";
import { t, type TranslationKey } from "@khidi/i18n";
import { useLightbox, type LightboxImage } from "./photo-lightbox.tsx";

type Activity = Awaited<ReturnType<typeof getReviewProduct>>["photoWork"];
type Row = Activity[number]["event"];
type Photo = { id: string; position: number; url: string };
type Action = "UPLOAD" | "ADJUST" | "INSTRUCT" | "CLEAN" | "BACKGROUND" | "DETAIL" | "SCENE";
const actions: Action[] = ["UPLOAD", "ADJUST", "INSTRUCT", "CLEAN", "BACKGROUND", "DETAIL", "SCENE"];
const aiModels: ReviewImageModel[] = ["gpt-image-2.6-sunburst", "gemini-3-pro-image", "gpt-image-2.6-flare", "gemini-3.1-flash-image"];
const examples: TranslationKey[] = ["studio.example.rust", "studio.example.light", "studio.example.glare", "studio.example.box"];
const date = new Intl.DateTimeFormat("ka-GE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tbilisi" });
const url = (product: string, photo: string) => "/api/catalog-review/photo/" + product + "/" + photo;
const boxed = (request: Row) => request.mode === "INSET" || request.mode === "MOUNT" || request.mode === "CLEAN"
  || request.mode === "INSTRUCT" && request.placement !== null;
const isAiEdit = (mode: ReviewPhotoMode) => mode === "CLEAN" || mode === "BACKGROUND" || mode === "INSTRUCT";
const methodsFor = (mode: ReviewPhotoMode, ready: ReviewImageModel[]): ReviewImageModel[] =>
  mode === "ADJUST" || mode === "INSET" ? ["local"]
    : [...(mode === "MOUNT" ? ["local" as const] : []), ...aiModels.filter(m => ready.includes(m))];
const errors: Record<number, TranslationKey> = { 400: "review.failed", 401: "review.expired", 409: "review.conflict",
  412: "review.paid_limit", 413: "review.image_invalid", 422: "review.render_failed" };

/** Simple line icons, drawn in the current text colour. */
const paths: Record<Action, string> = {
  UPLOAD: "M12 15V4m-5 5 5-5 5 5M4 15v5h16v-5",
  ADJUST: "M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5M12 8v4l3 2",
  INSTRUCT: "M4 20 14 10m-2-2 4 4M17 3l.9 1.9L20 6l-2.1.9L17 9l-.9-2.1L14 6l2.1-1.1zM6 4l.6 1.4L8 6l-1.4.6L6 8l-.6-1.4L4 6l1.4-.6z",
  CLEAN: "M15 4l5 5-9 9H7l-3-3 11-11zM9 10l5 5M13 20h7",
  BACKGROUND: "M4 4h16v16H4zM8 16h8M12 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6",
  DETAIL: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 8v8M8 12h8",
  SCENE: "M3 19l6-8 4 5 3-3 5 6H3zM17 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4"
};
const modeAction = (mode: ReviewPhotoMode): Action => mode === "INSET" || mode === "MOUNT" ? "DETAIL" : mode;
function StudioIcon({ action }: { action: Action }) {
  return <svg className="ps-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round"><path d={paths[action]}/></svg>;
}

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
    setPending(n => n + 1); setMessage(undefined);
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
    feedback: <p role="status" className="review-feedback ps-feedback">{message ? t(message) : null}</p> };
}

export function ReviewPhotoHistory({ activity }: { activity: Activity }) {
  if (!activity.length) return null;
  return <details className="photo-history"><summary>{t("review.photo_activity")} ({activity.length})</summary>
    <ol>{activity.slice().reverse().map(({ event, actor }) => <li key={event.id}>
      <strong>{t(`review.operation.${event.kind}`)}</strong> · {actor} · {date.format(new Date(event.createdAt))}
      {event.mode && <span> · {t(`review.${event.mode}`)}</span>}
      {event.detail && <span> · „{event.detail}“</span>}
      {event.model && <span> · {t(`studio.model.${event.model}`)}</span>}
      {event.note && <span> · {event.note}</span>}
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
  return <div className="ps-area">
    <div className="review-edit-canvas" onPointerDown={e => {
      if (disabled || e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId); move(e);
    }} onPointerMove={e => { if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) move(e); }}>
      <img src={url(productId, request.basePhotoId!)} alt={t("review.base")}/>
      {request.photoId ? <img className="review-detail-layer" data-mode={request.mode} src={url(productId, request.photoId)}
        alt={request.detail ?? ""} style={style}/> : <span className="studio-area" style={style}/>}
    </div>
    <small>{t(request.photoId ? "review.move_detail" : "studio.area")}</small>
    <div className="ps-sliders">{(["x", "y", "size"] as const).map(axis => <label key={axis}>
      <span>{t(axis === "size" && !request.photoId ? "studio.area_size" : `review.${axis}`)} · {value[axis]}%</span>
      <input type="range" min={axis === "size" ? 10 : 0} max={axis === "size" ? 70 : 100} value={value[axis]}
        onChange={e => onChange({ ...value, [axis]: Number(e.currentTarget.value) })}/></label>)}</div>
    <button type="button" className="ps-link" onClick={() => onChange(request.placement!)}>{t("review.reset_layout")}</button>
  </div>;
}

function Preview({ productId, mode, preview, render, accepted, rejected, onDone, sending, onOpen }: {
  productId: string; mode: ReviewPhotoMode; preview: Row; render: Row; accepted?: Row; rejected?: Row; onDone: boolean; onOpen: () => void;
  sending: ReturnType<typeof usePhotoAction>;
}) {
  const [reason, setReason] = useState(""), [asking, setAsking] = useState(false);
  // Same rule as the stored origin: an adjustment is a photo, an AI edit keeps the product, the rest are illustrations.
  const label = mode === "ADJUST" ? null : isAiEdit(mode) ? "store.kind.AI_EDIT" as const : "studio.illustration" as const;
  const mine = accepted?.photoId === preview.photoId;
  return <figure className="ps-result" data-state={mine ? "accepted" : rejected ? "rejected" : "open"}>
    <button type="button" className="studio-open" aria-label={t("lightbox.zoom")} onClick={onOpen}><img src={url(productId, preview.photoId!)} alt=""/></button>
    <figcaption><span className="ps-chip">{t(`studio.model.${render.model!}`)}</span>
      {label && <span className="ps-chip" data-kind={label === "studio.illustration" ? "illustration" : "ai"}>{t(label)}</span>}</figcaption>
    {mine && <p className="ps-done">✓ {t("review.approved_photo")}</p>}
    {rejected && <p className="studio-rejected">{t("studio.rejected")} · {rejected.note}</p>}
    {!onDone && !rejected && <div className="studio-verdict">
      <button type="button" className="ps-primary" disabled={sending.busy} onClick={() => sending.submit({ productId, previewId: preview.id })}>{t("studio.accept")}</button>
      {asking ? <><input maxLength={600} value={reason} aria-label={t("studio.reject_reason")} placeholder={t("studio.reject_reason")}
        onChange={e => setReason(e.target.value)}/>
        <button type="button" className="ps-secondary" disabled={sending.busy || !reason.trim()}
          onClick={() => sending.submit({ productId, previewId: preview.id, note: reason.trim() })}>{t("studio.reject_save")}</button></>
        : <button type="button" className="ps-secondary" onClick={() => setAsking(true)}>{t("studio.reject")}</button>}
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
    return ai.length ? ai.slice(0, 2) : methods.slice(0, 1);
  });
  const [running, setRunning] = useState<ReviewImageModel[]>([]);
  const sending = usePhotoAction();
  const ai = methods.some(m => m !== "local");
  // The viewer starts with the original so every version can be compared with what was photographed.
  const viewer = useLightbox(), shown = previews.slice().reverse();
  const gallery: LightboxImage[] = [{ url: url(productId, request.basePhotoId!), caption: t("lightbox.original") },
    ...shown.map(e => ({ url: url(productId, e.photoId!), caption: t(`studio.model.${renders.find(r => r.id === e.parentId)!.model!}`) }))];
  function make() {
    for (const model of chosen) {
      setRunning(r => [...r, model]);
      void sending.submit({ productId, requestId: request.id, model,
        ...(boxed(request) ? { placement: p } : {}), ...(mode === "ADJUST" ? { settings } : {}) })
        .finally(() => setRunning(r => { const i = r.indexOf(model); return i < 0 ? r : [...r.slice(0, i), ...r.slice(i + 1)]; }));
    }
  }
  const toggle = (m: ReviewImageModel) => choose(c => c.includes(m) ? c.filter(x => x !== m) : [...c, m].slice(-2));
  const status = accepted ? "done" : running.length ? "running"
    : shown.some(e => !events.some(x => x.kind === "REJECT" && x.parentId === e.id)) ? "choose" : "ready";
  return <article className="ps-job" data-state={accepted ? "done" : "open"}>
    <header className="ps-job-head"><StudioIcon action={modeAction(mode)}/>
      <div><h4>{t(`review.${mode}`)}</h4>{request.detail && <p>„{request.detail}“</p>}</div>
      <span className="ps-status" data-status={status}>{t(`studio.status.${status}`)}</span></header>
    {!accepted && <fieldset className="ps-job-body" disabled={sending.busy}>
      <div className="ps-job-source">
        {boxed(request) && p ? <AreaPicker productId={productId} request={request} value={p} onChange={place} disabled={sending.busy}/>
          : <button type="button" className="studio-open studio-base-open" aria-label={t("lightbox.zoom") + ": " + t("lightbox.original")}
            onClick={() => viewer.open(gallery, 0)}><img className="ps-source-img" src={url(productId, request.basePhotoId!)} alt={t("review.base")}/></button>}
      </div>
      <div className="ps-job-controls">
        {mode === "ADJUST" && <div className="ps-options">
          <button type="button" className="ps-toggle" onClick={() => setSettings(s => ({ ...s, rotate: (s.rotate + 90) % 360 as ReviewAdjustment["rotate"] }))}>
            ↻ {t("studio.rotate")} · {settings.rotate}°</button>
          <label className="studio-check"><input type="checkbox" checked={settings.trim} onChange={e => setSettings(s => ({ ...s, trim: e.target.checked }))}/>{t("studio.trim")}</label>
          <label className="studio-check"><input type="checkbox" checked={settings.tone} onChange={e => setSettings(s => ({ ...s, tone: e.target.checked }))}/>{t("studio.tone")}</label>
        </div>}
        {methods.length > 1 && <div className="ps-methods" role="group" aria-label={t("studio.methods")}><span className="ps-label">{t("studio.methods")}</span>
          <div>{methods.map(m => <button type="button" key={m} className="ps-toggle" aria-pressed={chosen.includes(m)} onClick={() => toggle(m)}>
            {t(`studio.model.${m}`)}</button>)}</div></div>}
        {!methods.length && <p className="ps-note">{t("studio.no_ai")}</p>}
        {ai && <p className="ps-note">{t(isAiEdit(mode) ? "studio.ai_note.edit" : "studio.ai_note.illustration")}</p>}
        <button type="button" className="ps-primary ps-wide" disabled={!chosen.length || !methods.length || running.length > 0} onClick={make}>
          {t(chosen.length > 1 ? "studio.compare" : "studio.make")}</button>
        {failed > 0 && <p className="ps-note" role="alert">{t("review.render_failed")} ({failed})</p>}
        {sending.feedback}
      </div>
    </fieldset>}
    {(shown.length > 0 || running.length > 0) && <div className="ps-results">
      {running.map((m, i) => <div key={m + i} className="ps-result ps-skeleton" aria-busy="true"><div className="ps-shimmer"/>
        <p><span className="ps-spinner" aria-hidden="true"/>{t(`studio.model.${m}`)} · {t(m === "local" ? "review.working_photo" : "studio.waiting")}</p></div>)}
      {shown.map((e, i) => <Preview key={e.id} productId={productId} mode={mode} preview={e} sending={sending} onDone={Boolean(accepted)}
        onOpen={() => viewer.open(gallery, i + 1)} render={renders.find(r => r.id === e.parentId)!} accepted={accepted}
        rejected={events.find(x => x.kind === "REJECT" && x.parentId === e.id)}/>)}</div>}
    {viewer.node}
  </article>;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return <li className="ps-step"><h3><span className="ps-num">{n}</span>{title}</h3>{children}</li>;
}

export function ReviewPhotoStudio({ productId, photos, activity, ready }: {
  productId: string; photos: Photo[]; activity: Activity; ready: ReviewImageModel[];
}) {
  const [action, setAction] = useState<Action>("UPLOAD");
  const [base, setBase] = useState(photos[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState(""), [area, setArea] = useState(false);
  const sending = usePhotoAction(), viewer = useLightbox();
  const events = activity.map(row => row.event);
  const needsBase = action !== "UPLOAD", basePhoto = base || photos[0]?.id;
  const aiOnly = action === "INSTRUCT" || action === "CLEAN" || action === "BACKGROUND" || action === "SCENE";
  const withFile = action === "UPLOAD" || action === "DETAIL";
  const noteField = action === "INSTRUCT" || action === "CLEAN" || action === "SCENE";
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (withFile) {
      if (!file) return;
      const form = e.currentTarget, data = new FormData(form);
      data.set("productId", productId);
      data.set("kind", action === "UPLOAD" ? "UPLOAD" : "REQUEST");
      if (action === "UPLOAD") { data.delete("basePhotoId"); data.delete("detail"); data.delete("mode"); }
      data.set("image", file);
      void sending.submit(data, () => { form.reset(); setFile(null); });
    } else {
      void sending.submit({ productId, basePhotoId: basePhoto, mode: action, ...(note.trim() ? { detail: note.trim() } : {}),
        ...(action === "INSTRUCT" ? { area } : {}) }, () => { setNote(""); setArea(false); });
    }
  }
  const requests = events.filter(e => e.kind === "REQUEST").reverse();
  const open = requests.filter(r => !events.some(e => e.kind === "ACCEPT" && e.parentId === r.id));
  const done = requests.filter(r => !open.includes(r));
  const field: Partial<Record<Action, [TranslationKey, TranslationKey]>> = {
    INSTRUCT: ["studio.instruct_label", "studio.instruct_hint"], CLEAN: ["studio.clean_label", "studio.clean_hint"],
    SCENE: ["studio.scene_label", "studio.scene_hint"] };
  return <section className="review-photo-studio ps">
    <header className="ps-head"><h2>{t("studio.title")}</h2><p>{t("studio.subtitle")}</p></header>
    <form onSubmit={submit}><fieldset disabled={sending.busy} className="ps-form"><ol className="ps-steps">
      <Step n={1} title={t("studio.step.what")}>
        <div className="ps-cards" role="radiogroup" aria-label={t("studio.step.what")}>{actions.map(a =>
          <button type="button" role="radio" aria-checked={a === action} key={a} className="ps-card"
            onClick={() => { setAction(a); setNote(""); setArea(false); }}>
            <StudioIcon action={a}/><strong>{t(`studio.action.${a}`)}</strong><span>{t(`studio.card.${a}`)}</span>
            {a !== "UPLOAD" && <small data-tag={a === "ADJUST" ? "free" : "ai"}>{t(a === "ADJUST" ? "studio.tag.free" : "studio.tag.ai")}</small>}</button>)}</div>
      </Step>
      {needsBase && <Step n={2} title={t("studio.base")}>
        {photos.length ? <div className="studio-bases" role="radiogroup" aria-label={t("studio.base")}>
          {photos.map((photo, i) => <span className="studio-base" key={photo.id}>
            <button type="button" role="radio" aria-checked={photo.id === basePhoto} onClick={() => setBase(photo.id)}>
              <img src={photo.url} alt={t("review.photo") + " " + photo.position} width={112} height={112}/></button>
            <button type="button" className="studio-zoom" aria-label={t("lightbox.zoom") + ": " + t("review.photo") + " " + photo.position}
              onClick={() => viewer.open(photos.map(p => ({ url: p.url, caption: t("review.photo") + " " + p.position })), i)}>🔍</button></span>)}
          <input type="hidden" name="basePhotoId" value={basePhoto ?? ""}/></div> : <p className="ps-note">{t("review.add_base_first")}</p>}
      </Step>}
      <Step n={needsBase ? 3 : 2} title={t(withFile ? "studio.step.file" : noteField ? "studio.step.describe" : "studio.step.start")}>
        <p className="studio-help">{t(`studio.help.${action}`)}</p>
        {action === "DETAIL" && <div className="ps-grid2">
          <label>{t("review.detail")}<input name="detail" maxLength={240} required placeholder={t("review.detail_hint")}/></label>
          <label>{t("review.presentation")}<select name="mode"><option value="MOUNT">{t("review.MOUNT")}</option>
            <option value="INSET">{t("review.INSET")}</option></select></label></div>}
        {noteField && <label className="ps-instruction"><span className="ps-label">{t(field[action]![0])}</span>
          {action === "INSTRUCT"
            ? <textarea rows={2} maxLength={240} required value={note} placeholder={t(field[action]![1])} onChange={e => setNote(e.target.value)}/>
            : <input maxLength={240} required value={note} placeholder={t(field[action]![1])} onChange={e => setNote(e.target.value)}/>}</label>}
        {action === "INSTRUCT" && <>
          <div className="ps-examples"><span>{t("studio.examples")}</span>{examples.map(k => <button type="button" key={k} className="ps-example"
            onClick={() => setNote(t(k))}>{t(k)}</button>)}</div>
          <label className="studio-check"><input type="checkbox" checked={area} onChange={e => setArea(e.target.checked)}/>{t("studio.instruct_area")}</label></>}
        {withFile && <label className="ps-file"><span className="ps-label">{t(action === "UPLOAD" ? "review.upload" : "review.source_image")}</span>
          <input type="file" required accept="image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)}/>
          <small>{t("review.file_help")}</small></label>}
        {aiOnly && !ready.length && <p className="ps-note">{t("studio.no_ai")}</p>}
        <button type="submit" className="ps-primary ps-wide" disabled={needsBase && !photos.length || aiOnly && !ready.length
          || withFile && (!file || file.size > 15 * 1024 * 1024) || noteField && !note.trim()}>
          {t(action === "UPLOAD" ? "review.upload_save" : action === "DETAIL" ? "review.layout_suggest" : "studio.start")}</button>
        {file && file.size > 15 * 1024 * 1024 && <small role="alert">{t("review.image_invalid")}</small>}
        {sending.waiting && <p className="ps-note"><span className="ps-spinner" aria-hidden="true"/>{t("review.working_photo")}</p>}
        {sending.feedback}
      </Step>
    </ol></fieldset></form>
    {open.length > 0 && <section className="ps-jobs"><h3>{t("studio.jobs")} ({open.length})</h3>
      {open.map(r => <EditRequest key={r.id} productId={productId} request={r} events={events} ready={ready}/>)}</section>}
    {done.length > 0 && <details className="ps-done-list"><summary>{t("studio.done")} ({done.length})</summary>
      {done.map(r => <EditRequest key={r.id} productId={productId} request={r} events={events} ready={ready}/>)}</details>}
    <ReviewPhotoHistory activity={activity}/>{viewer.node}
  </section>;
}

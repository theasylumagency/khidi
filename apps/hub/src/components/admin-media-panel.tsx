"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ManagedImageView } from "@khidi/media";
import type { PhotoSlot } from "@khidi/media/contracts";
import { createUuidV7 } from "@khidi/shared/uuid";
import { t, type TranslationKey } from "@khidi/i18n";
import { PhotoRequestForm } from "./photo-request-form.tsx";
import { PhotoWorkspace } from "./photo-workspace.tsx";
import "./media.css";
function ImageCard({ image, assignees }: { image: ManagedImageView; assignees: { id: string; fullName: string }[] }) {
  const router = useRouter(), key = useRef(createUuidV7()), payload = useRef("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [request, setRequest] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget), button = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null, action = button?.value ?? "UPDATE";
    const reason = String(data.get("reason") ?? "").trim();
    if (action === "REJECT" && !reason) { setError(t("media.reject_reason_required")); return; }
    const body = { imageId: image.id, action, ...(action === "UPDATE" ? { role: data.get("role"), usage: data.get("usage"), sortOrder: Number(data.get("sortOrder")) } : {}), ...(reason && action === "REJECT" ? { reason } : {}) };
    const encoded = JSON.stringify(body); if (payload.current && payload.current !== encoded) key.current = createUuidV7(); payload.current = encoded;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/media/images", { method: "POST", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, idempotencyKey: key.current }) });
      if (!response.ok) { const result = await response.json(); setError(result.error ?? t("media.error.GENERIC")); return; }
      if (action === "REJECT") setRequest(true); key.current = createUuidV7(); payload.current = ""; router.refresh();
    } catch { setError(t("media.error.GENERIC")); } finally { setBusy(false); }
  }
  return <article className="media-admin-card"><img src={image.previewUrl} alt={t(`media.slot.${image.slot}` as TranslationKey)} width={200} height={200} loading="lazy" />
    <div><strong>{t(`media.slot.${image.slot}` as TranslationKey)}</strong><p>{t(`media.image_status.${image.status}` as TranslationKey)} · {t(`media.job_status.${image.processingStatus}` as TranslationKey)}</p>
      <p>{image.width} × {image.height} · {(image.rawBytes / 1048576).toFixed(1)} {t("media.megabytes")}</p><a href={image.rawUrl} target="_blank" rel="noreferrer">{t("media.raw")}</a>
      <details><summary>{t("media.versions")} ({image.versions.length})</summary>{image.versions.map((version) => <div key={version.version}><a href={version.masterUrl} target="_blank" rel="noreferrer">{t("media.master")} {version.version}</a><span> · </span>{version.derivatives.map((d) => <a key={d.variant} href={d.url} target="_blank" rel="noreferrer" style={{ marginRight: 12 }}>{d.width} {d.format.toUpperCase()}</a>)}</div>)}<p>{t("media.sha256")}: <code>{image.rawSha256}</code></p></details>
      {image.tier2 && Array.isArray(image.tier2.nearDuplicates) && image.tier2.nearDuplicates.length ? <p role="status">{t("media.near_duplicates").replace("{count}", String(image.tier2.nearDuplicates.length))}</p> : null}
      {image.rejectReason ? <p>{t("media.reject_reason")}: {image.rejectReason}</p> : null}
      <form onSubmit={submit}><div className="scanning-fields"><label>{t("media.role")}<select name="role" defaultValue={image.role}>{["MAIN", "GALLERY", "IDENTITY"].map((role) => <option key={role} value={role}>{t(`media.role.${role}` as TranslationKey)}</option>)}</select></label>
        <label>{t("media.usage")}<select name="usage" defaultValue={image.usage}>{["PUBLIC", "INTERNAL_EVIDENCE"].map((usage) => <option key={usage} value={usage}>{t(`media.usage.${usage}` as TranslationKey)}</option>)}</select></label>
        <label>{t("media.sort_order")}<input name="sortOrder" type="number" min={0} max={2147483647} step={1} defaultValue={image.sortOrder} required /></label><label>{t("media.reject_reason")}<input name="reason" maxLength={4000} /></label></div>
        <div className="scanning-actions"><button disabled={busy} value="UPDATE">{t("media.save")}</button><button disabled={busy || image.processingStatus !== "COMPLETED"} value="VERIFY">{t("media.verify")}</button><button disabled={busy} value="REJECT">{t("media.reject")}</button><button disabled={busy} value="REPROCESS">{t("media.reprocess")}</button></div></form>
      {error ? <p role="alert">{error}</p> : null}
      {image.skuId && (request || image.status === "REJECTED") ? <details open={request}><summary>{t("media.request_new")}</summary><PhotoRequestForm skuId={image.skuId} assignees={assignees} initialSlots={[image.slot as PhotoSlot]} /></details> : null}
    </div></article>;
}
export function AdminMediaPanel({ images, skuId, assignees }: { images: ManagedImageView[]; skuId?: string; assignees: { id: string; fullName: string }[] }) {
  const [capture, setCapture] = useState(false), router = useRouter();
  return <section className="media-admin"><h2>{t("media.images")}</h2><nav className="scanning-actions"><Link href="/media/jobs">{t("media.jobs")}</Link><button type="button" onClick={() => router.refresh()}>{t("media.refresh_links")}</button>{skuId ? <button type="button" onClick={() => setCapture(!capture)}>{t("media.add_photo")}</button> : null}</nav>
    {capture && skuId ? <PhotoWorkspace target={{ skuId }} onComplete={() => { setCapture(false); router.refresh(); }} /> : null}
    {!images.length ? <p>{t("media.no_images")}</p> : images.map((image) => <ImageCard key={`${image.id}:${image.updatedAt}`} image={image} assignees={assignees} />)}</section>;
}

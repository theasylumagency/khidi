"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t, type TranslationKey } from "@khidi/i18n";
import type { DecisionInput } from "@khidi/catalog-review";
import { CatalogReviewPhotos, type ReviewPhoto } from "./catalog-review-photos.tsx";

type Props = {
  id: string | null;
  productId?: string;
  field?: "NAME" | "SHORT" | "FULL";
  textVersion?: string;
  onLockedChange?: (locked: boolean) => void;
  revision: number;
  text: string | null;
  photos?: ReviewPhoto[];
  proposedPhotoId: string | null;
  currentPhotoId: string | null;
  continueHref?: string;
  stayHref?: string;
};

export function CatalogDecisionForm({ id, revision, text, photos, proposedPhotoId, currentPhotoId, continueHref,
  productId, field, textVersion, onLockedChange, stayHref }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState(currentPhotoId ?? proposedPhotoId ?? "");
  const [message, setMessage] = useState<TranslationKey>();
  const request = useRef<{ body: string; key: string } | null>(null);
  const missingPhoto = photos?.length === 0;
  useEffect(() => { onLockedChange?.(editing || busy || saved); }, [editing, busy, saved, onLockedChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || saved) return;
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") as DecisionInput["action"] | undefined;
    if (!action) return;
    const values = new FormData(event.currentTarget);
    const input = id ? {
      proposalId: id, revision, action,
      note: String(values.get("note") ?? ""),
      ...(action === "EDIT" ? { editedText: String(values.get("editedText") ?? "") } : {}),
      ...(photos && action === "APPROVE" ? { photoId: selected } : {}),
      ...(!photos && action === "APPROVE" ? { textVersion } : {})
    } : {
      productId, field, text: String(values.get("editedText") ?? ""), note: String(values.get("note") ?? "")
    };
    const body = JSON.stringify(input);
    if (request.current?.body !== body) request.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch(id ? "/api/catalog-review/decision" : "/api/catalog-review/text", {
        method: "POST", body,
        headers: { "Content-Type": "application/json", "Idempotency-Key": request.current.key }
      });
      if (!response.ok) {
        setMessage(response.status === 409 ? (editing ? "review.text_conflict" : "review.conflict")
          : response.status === 401 ? "review.expired" : "review.failed");
        return;
      }
      setSaved(true);
      setMessage("review.saved");
      if (action === "EDIT" && stayHref && stayHref !== window.location.pathname + window.location.search) {
        router.replace(stayHref, { scroll: false });
      } else if (continueHref && action !== "EDIT") router.replace(continueHref);
      else router.refresh();
    } catch {
      setMessage("review.failed");
    } finally {
      setBusy(false);
    }
  }

  return <form className="review-form" onSubmit={submit} aria-busy={busy}>
    {photos && photos.length > 0 ? <CatalogReviewPhotos photos={photos} selected={selected} onSelect={setSelected}
      proposedPhotoId={proposedPhotoId} disabled={busy || saved} /> : null}
    {missingPhoto ? <p className="review-empty-help">{t("review.photo_defer_archive")}</p> : null}
    {editing ? <label>{t("review.text.EDIT")}
      <textarea name="editedText" rows={8} defaultValue={text ?? ""} required maxLength={20000} disabled={busy || saved} autoFocus />
    </label> : null}
    {showNote ? <label>{t("review.note")}
      <textarea name="note" rows={2} maxLength={2000} disabled={busy || saved} autoFocus />
    </label> : <button className="review-add-note" type="button" onClick={() => setShowNote(true)}
      disabled={busy || saved}>{t("review.add_note")}</button>}
    <div className="review-actions">
      {editing ? <>
        <button value="EDIT" data-primary="true" disabled={busy || saved}>{t("review.save_edit")}</button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy || saved}>{t("review.cancel_edit")}</button>
      </> : <>
        {id && !missingPhoto ? <button value="APPROVE" data-primary="true" disabled={busy || saved || Boolean(photos && !selected)}>{t(photos ? "review.text.APPROVE" : "review.approve_text_version")}</button> : null}
        {!photos ? <button type="button" data-primary={!id} onClick={() => setEditing(true)} disabled={busy || saved}>{t(id || text?.trim() ? "review.text.EDIT" : "review.add_text")}</button> : null}
        {id ? <button value="DEFER" data-primary={missingPhoto} disabled={busy || saved}>{t("review.text.DEFER")}</button> : null}
        {id && !missingPhoto ? <button value="REJECT" disabled={busy || saved}>{t("review.text.REJECT")}</button> : null}
      </>}
    </div>
    {editing ? <p className="review-quiet review-continue-hint">{t("review.edit_save_hint")}</p>
      : continueHref ? <p className="review-quiet review-continue-hint">{t("review.continue_hint")}</p> : null}
    <p className="review-feedback" role="status">{message ? t(message) : null}</p>
  </form>;
}

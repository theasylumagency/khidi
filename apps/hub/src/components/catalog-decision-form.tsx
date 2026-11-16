"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t, type TranslationKey } from "@khidi/i18n";
import type { DecisionInput } from "@khidi/catalog-review";
import { CatalogReviewPhotos, type ReviewPhoto } from "./catalog-review-photos.tsx";

type Props = {
  id: string;
  revision: number;
  text: string | null;
  photos?: ReviewPhoto[];
  proposedPhotoId: string | null;
  currentPhotoId: string | null;
  continueHref?: string;
};

export function CatalogDecisionForm({ id, revision, text, photos, proposedPhotoId, currentPhotoId, continueHref }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState(currentPhotoId ?? proposedPhotoId ?? "");
  const [message, setMessage] = useState<TranslationKey>();
  const request = useRef<{ body: string; key: string } | null>(null);
  const missingPhoto = photos?.length === 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || saved) return;
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") as DecisionInput["action"] | undefined;
    if (!action) return;
    const values = new FormData(event.currentTarget);
    const input: DecisionInput = {
      proposalId: id, revision, action,
      note: String(values.get("note") ?? ""),
      ...(action === "EDIT" ? { editedText: String(values.get("editedText") ?? "") } : {}),
      ...(photos && action === "APPROVE" ? { photoId: selected } : {})
    };
    const body = JSON.stringify(input);
    if (request.current?.body !== body) request.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/catalog-review/decision", {
        method: "POST", body,
        headers: { "Content-Type": "application/json", "Idempotency-Key": request.current.key }
      });
      if (!response.ok) {
        setMessage(response.status === 409 ? "review.conflict" : response.status === 401 ? "review.expired" : "review.failed");
        return;
      }
      setSaved(true);
      setMessage("review.saved");
      if (continueHref) router.replace(continueHref);
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
        {!missingPhoto ? <button value="APPROVE" data-primary="true" disabled={busy || saved || Boolean(photos && !selected)}>{t("review.text.APPROVE")}</button> : null}
        {!photos ? <button type="button" onClick={() => setEditing(true)} disabled={busy || saved}>{t("review.text.EDIT")}</button> : null}
        <button value="DEFER" data-primary={missingPhoto} disabled={busy || saved}>{t("review.text.DEFER")}</button>
        {!missingPhoto ? <button value="REJECT" disabled={busy || saved}>{t("review.text.REJECT")}</button> : null}
      </>}
    </div>
    {continueHref ? <p className="review-quiet review-continue-hint">{t("review.continue_hint")}</p> : null}
    <p className="review-feedback" role="status">{message ? t(message) : null}</p>
  </form>;
}

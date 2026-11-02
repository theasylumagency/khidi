"use client";
import { useRef, useState, type FormEvent } from "react";
import { createUuidV7 } from "@khidi/shared/uuid";
import { PHOTO_SLOTS, type PhotoSlot } from "@khidi/media/contracts";
import { t, type TranslationKey } from "@khidi/i18n";
export function PhotoRequestForm({ skuId, assignees, initialSlots = ["MAIN"] }: { skuId: string; assignees: { id: string; fullName: string }[]; initialSlots?: PhotoSlot[] }) {
  const key = useRef(createUuidV7()), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    const assignee = String(data.get("assignee")); setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/scanning/tasks", { method: "POST", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        idempotencyKey: key.current, taskType: "PHOTO_REQUEST", title: data.get("title"), targetSkuId: skuId,
        requestedPhotoSlots: data.getAll("slot"), photoRequestNote: data.get("note"), assigneeRole: assignee === "WAREHOUSE" ? "WAREHOUSE" : null, assigneeUserId: assignee === "WAREHOUSE" ? null : assignee
      }) });
      if (!response.ok) { const body = await response.json(); setError(body.error ?? t("scanning.error")); return; }
      key.current = createUuidV7(); form.reset(); setMessage(t("media.request_created"));
    } catch { setError(t("scanning.error")); } finally { setBusy(false); }
  }
  return <form onSubmit={submit}><h3>{t("media.request_new")}</h3><div className="scanning-fields">
    <label>{t("scanning.title")}<input name="title" defaultValue={t("media.photo_request")} required maxLength={200} /></label>
    <label>{t("scanning.assignee")}<select name="assignee"><option value="WAREHOUSE">{t("scanning.role.WAREHOUSE")}</option>{assignees.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
    <label>{t("media.request_note")}<textarea name="note" required maxLength={4000} /></label></div>
    <fieldset><legend>{t("media.request_slots")}</legend>{PHOTO_SLOTS.map((slot) => <label key={slot} style={{ display: "inline-flex", gap: 8, padding: 12 }}><input type="checkbox" name="slot" value={slot} defaultChecked={initialSlots.includes(slot)} />{t(`media.slot.${slot}` as TranslationKey)}</label>)}</fieldset>
    <button disabled={busy}>{t("media.photo_request")}</button>{message ? <p role="status">{message}</p> : null}{error ? <p role="alert">{error}</p> : null}</form>;
}

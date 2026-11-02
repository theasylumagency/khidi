"use client";
import { useState, type FormEvent } from "react";
import { t } from "@khidi/i18n";

export function IntakeReviewForm({ intakeId, idempotencyKey, canAccept, closedTask, replacementRequired, candidates }: {
  intakeId: string; idempotencyKey: string; canAccept: boolean; closedTask: boolean; replacementRequired: boolean;
  candidates: { internalSku: string; displayNameKa: string | null }[]
}) {
  const [resolution, setResolution] = useState("LINK_EXISTING");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/scanning/review", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey, intakeId, resolution, note: data.get("note"),
          ...(resolution === "LINK_EXISTING" ? { skuCode: String(data.get("skuCode")).trim(), requestReplacementLabel: replacementRequired || data.get("replacement") === "on" } : {}),
          reopenTask: resolution === "ACCEPT_FOR_TASK" && data.get("reopenTask") === "on"
        }) });
      if (!response.ok) { const body = await response.json(); setError(body.error ?? t("scanning.error")); return; }
      window.location.reload();
    } catch { setError(t("scanning.error")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit}>
    <label>{t("scanning.review_resolution")}<select value={resolution} onChange={(event) => setResolution(event.target.value)}>
      <option value="LINK_EXISTING">{t("scanning.review_link")}</option>
      {canAccept ? <option value="ACCEPT_FOR_TASK">{t("scanning.review_accept")}</option> : null}
      <option value="DISMISS">{t("scanning.review_dismiss")}</option>
    </select></label>
    {resolution === "LINK_EXISTING" ? <>
      <label>{t("scanning.sku")}<input name="skuCode" list="review-skus" required pattern="KH-[0-9]{6,}" autoComplete="off" /></label>
      <datalist id="review-skus">{candidates.map((sku) => <option key={sku.internalSku} value={sku.internalSku}>{sku.displayNameKa ?? sku.internalSku}</option>)}</datalist>
      <label className="scanning-checkbox"><input type="checkbox" name="replacement" defaultChecked={replacementRequired} disabled={replacementRequired} />{t("scanning.review_replacement")}</label>
    </> : null}
    {resolution === "ACCEPT_FOR_TASK" && closedTask ? <label className="scanning-checkbox"><input type="checkbox" name="reopenTask" required />{t("scanning.review_reopen")}</label> : null}
    <label>{t("scanning.review_note")}<textarea name="note" required maxLength={4000} rows={3} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <button type="submit" disabled={busy}>{t(busy ? "scanning.saving" : "scanning.review_save")}</button>
  </form>;
}

"use client";
import { useState } from "react";
import { t } from "@khidi/i18n";

export function BatchLabelPrinter({ html, intakeIds, idempotencyKey }: { html: string; intakeIds: string[]; idempotencyKey: string }) {
  const [opened, setOpened] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function confirmPrinted() {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/scanning/labels", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intakeIds, idempotencyKey }) });
      if (!response.ok) { setError(t("scanning.error")); return; }
      window.location.assign("/labels");
    } catch { setError(t("scanning.error")); }
    finally { setSaving(false); }
  }
  return <div>
    <div className="scanning-actions"><button type="button" onClick={() => {
      // A separate authenticated document prints only the fixed-size labels.
      const params = new URLSearchParams(); intakeIds.forEach((id) => params.append("intakeIds", id));
      window.open(`/api/scanning/labels/print?${params}`, "_blank", "noopener,noreferrer"); setOpened(true);
    }}>{t("scanning.print")}</button>
      <button type="button" disabled={!opened || saving} onClick={confirmPrinted}>{t(saving ? "scanning.saving" : "scanning.mark_printed")}</button>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    <iframe title={t("scanning.labels")} srcDoc={html} sandbox="" style={{ width: "100%", height: 420, border: "1px solid #cbd5e1" }} />
  </div>;
}

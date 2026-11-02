"use client";
import { useRef, useState } from "react";
import { t } from "@khidi/i18n";

export function BatchLabelPrinter({ html, intakeIds, idempotencyKey }: { html: string; intakeIds: string[]; idempotencyKey: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
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
    <div className="scanning-actions"><button type="button" disabled={!ready} onClick={() => {
      frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); setOpened(true);
    }}>{t("scanning.print")}</button>
      <button type="button" disabled={!opened || saving} onClick={confirmPrinted}>{t(saving ? "scanning.saving" : "scanning.mark_printed")}</button>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    <iframe ref={frame} title={t("scanning.labels")} srcDoc={html} sandbox="allow-same-origin allow-modals" onLoad={() => setReady(true)} style={{ width: "100%", height: 420, border: "1px solid #cbd5e1" }} />
  </div>;
}

"use client";
import { useRef, useState } from "react";
import { createUuidV7 } from "@khidi/shared/uuid";
import { t } from "@khidi/i18n";
export function MediaJobRetry({ jobId }: { jobId: string }) {
  const key = useRef(createUuidV7()), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <><button disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/media/jobs", { method: "POST", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: key.current, jobId }) });
      if (!response.ok) throw new Error(); window.location.reload();
    } catch { setError(t("media.error.GENERIC")); setBusy(false); }
  }}>{t("media.retry_job")}</button>{error ? <p role="alert">{error}</p> : null}</>;
}

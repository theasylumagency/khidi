"use client";
import { useRef, useState, type FormEvent } from "react";
import { createUuidV7 } from "@khidi/shared/uuid";
import { t } from "@khidi/i18n";

export function AdminQuickScan({ userId, deviceId }: { userId: string; deviceId: string | null }) {
  const field = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  async function submit(noBarcode: boolean) {
    const scannedValue = noBarcode ? "" : field.current?.value.trim() ?? "";
    if (!noBarcode && !scannedValue) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/scanning/intakes", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: createUuidV7(), userId, deviceId: deviceId ?? createUuidV7(), scannedAt: new Date().toISOString(), sourceMode: "QUICK_SCAN", scannedValue, isNoBarcode: noBarcode }) });
      if (!response.ok) { setError(t("scanning.error")); return; }
      setMessage(t("warehouse.scan_accepted")); if (field.current) field.current.value = "";
    } catch { setError(t("scanning.error")); }
    finally { setBusy(false); field.current?.focus(); }
  }
  function onSubmit(event: FormEvent) { event.preventDefault(); void submit(false); }
  return <form onSubmit={onSubmit}><label>{t("scanning.code")}<input ref={field} autoFocus maxLength={512} autoComplete="off" /></label>
    <div className="scanning-actions"><button disabled={busy} type="submit">{t("scanning.accept")}</button><button disabled={busy} type="button" onClick={() => void submit(true)}>{t("scanning.no_barcode")}</button></div>
    <p aria-live="polite">{message}</p>{error ? <p role="alert">{error}</p> : null}
    <p>{t("scanning.photos_pending")}</p>
  </form>;
}

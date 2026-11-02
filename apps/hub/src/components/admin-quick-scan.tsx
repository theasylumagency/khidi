"use client";
import { useRef, useState, type FormEvent } from "react";
import { t } from "@khidi/i18n";
import { useScanQueue } from "./scan-queue-provider.tsx";

export function AdminQuickScan() {
  const queue = useScanQueue();
  const field = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  async function submit(noBarcode: boolean) {
    const scannedValue = noBarcode ? "" : field.current?.value.trim() ?? "";
    if (!noBarcode && !scannedValue) return;
    setBusy(true); setError("");
    try {
      await queue.enqueue({ sourceMode: "QUICK_SCAN", taskId: null, scannedValue, isNoBarcode: noBarcode });
      setMessage(t("warehouse.scan_accepted")); if (field.current) field.current.value = "";
    } catch { setError(t("scanning.storage_error")); }
    finally { setBusy(false); field.current?.focus(); }
  }
  function onSubmit(event: FormEvent) { event.preventDefault(); void submit(false); }
  return <form onSubmit={onSubmit}><label>{t("scanning.code")}<input ref={field} autoFocus maxLength={512} autoComplete="off" /></label>
    <div className="scanning-actions"><button disabled={busy || !queue.ready} type="submit">{t("scanning.accept")}</button><button disabled={busy || !queue.ready} type="button" onClick={() => void submit(true)}>{t("scanning.no_barcode")}</button></div>
    <p aria-live="polite">{message}</p>{error ? <p role="alert">{error}</p> : null}
    <p>{t("scanning.photos_pending")}</p>
  </form>;
}

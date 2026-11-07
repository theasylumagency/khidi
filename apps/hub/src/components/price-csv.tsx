"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type TranslationKey } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import { PricePreview, type PricePreviewRow } from "./price-preview.tsx";

interface CsvReview {
  rows: { rowNumber: number; internalSku: string; errors: string[]; unchanged: boolean; excluded: boolean; change: { skuId: string } | null }[];
  preview: PricePreviewRow[]; errors: string[]; canCommit: boolean;
}
export function PriceCsv({ storefrontId }: { storefrontId: string }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [excludedRows, setExcludedRows] = useState<number[]>([]);
  const [review, setReview] = useState<CsvReview | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [key, setKey] = useState("");
  async function send(body: unknown, idempotencyKey?: string) {
    const response = await fetch("/api/prices/csv", { method: "POST", headers: { "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? t("scanning.error"));
    return result;
  }
  async function preview(excluded: number[] = excludedRows) {
    setBusy(true); setMessage("");
    try {
      setReview(await send({ action: "preview", input: { storefrontId, csv, excludedRows: excluded } }));
      setExcludedRows(excluded); setKey(createUuidV7());
    } catch (error) { setMessage(error instanceof Error ? error.message : t("scanning.error")); }
    finally { setBusy(false); }
  }
  async function commit(reason: string | undefined, confirmLargeChanges: boolean) {
    if (!review?.canCommit) return;
    setBusy(true); setMessage("");
    try {
      await send({ action: "commit", input: { storefrontId, csv, excludedRows }, reason, confirmLargeChanges,
        expectedPriceIds: Object.fromEntries(review.preview.map((row) => [row.skuId, row.expectedPriceId])) }, key);
      setReview(null); setCsv(""); setExcludedRows([]); setMessage(t("pricing.saved")); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : t("scanning.error")); }
    finally { setBusy(false); }
  }
  const names = Object.fromEntries((review?.rows ?? []).flatMap((row) => row.change ? [[row.change.skuId, row.internalSku]] : []));
  return <section className="pricing"><h2>{t("pricing.import")}</h2>
    <p>{t("pricing.csv_blank_unchanged")}</p>
    <fieldset disabled={busy}><label>{t("pricing.import")} <input type="file" accept=".csv,text/csv" onChange={async (event) => {
      const file = event.target.files?.[0]; setReview(null); setExcludedRows([]); setMessage("");
      if (!file || file.size > 2_000_000) { setCsv(""); setMessage(t("pricing.csv.INVALID_CSV")); return; }
      setCsv(await file.text());
    }} /></label><button type="button" disabled={!csv} onClick={() => void preview()}>{t("pricing.preview")}</button></fieldset>
    {review ? <>
      {review.errors.map((error) => <p key={error} role="alert">{t(`pricing.csv.${error}` as TranslationKey)}</p>)}
      {review.rows.length ? <table><thead><tr><th>{t("pricing.row")}</th><th>{t("pricing.product")}</th><th>{t("pricing.errors")}</th><th>{t("pricing.exclude")}</th></tr></thead><tbody>
        {review.rows.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.internalSku}</td><td>{row.unchanged && !row.errors.length ? t("pricing.unchanged") : null}{row.errors.map((error) => <div key={error}>{t(`pricing.csv.${error}` as TranslationKey)}</div>)}</td>
          <td><input type="checkbox" disabled={busy} aria-label={t("pricing.exclude") + " " + row.rowNumber} checked={row.excluded} onChange={(event) => void preview(event.target.checked ? [...excludedRows, row.rowNumber] : excludedRows.filter((number) => number !== row.rowNumber))} /></td></tr>)}
      </tbody></table> : null}
      {review.preview.length ? <PricePreview key={key} rows={review.preview} names={names} busy={busy || !review.canCommit} onCommit={(reason, confirmed) => void commit(reason, confirmed)} onCancel={() => setReview(null)} /> : null}
    </> : null}
    <p role="status">{busy ? t("pricing.loading") : message}</p>
  </section>;
}

"use client";
import { useState } from "react";
import { t } from "@khidi/i18n";
import { formatPrice } from "@khidi/pricing/format";

export interface PricePreviewRow {
  skuId: string; storefrontId: string; kind: "SET" | "WITHDRAWN"; basePriceMinor?: number; currency: "GEL";
  vatIncluded: boolean; expectedPriceId: string | null; previous: { kind: "SET" | "WITHDRAWN"; basePriceMinor: number | null } | null;
  deltaMinor: number | null; differenceRatio: number | null; largeChange: boolean; unchanged: boolean;
}
export function previewChanges(rows: PricePreviewRow[]) {
  return rows.map(({ skuId, storefrontId, kind, basePriceMinor, currency, vatIncluded, expectedPriceId }) =>
    ({ skuId, storefrontId, kind, basePriceMinor, currency, vatIncluded, expectedPriceId }));
}
export function PricePreview({ rows, names, busy, onCommit, onCancel }: {
  rows: PricePreviewRow[]; names: Record<string, string>; busy: boolean;
  onCommit: (reason: string | undefined, confirmLargeChanges: boolean) => void; onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const large = rows.some((row) => row.largeChange);
  const needsReason = large || rows.some((row) => row.kind === "WITHDRAWN");
  return <section aria-label={t("pricing.preview")}>
    <h2>{t("pricing.preview")}</h2>
    <div style={{ overflowX: "auto" }}><table><thead><tr><th>{t("pricing.product")}</th><th>{t("pricing.current")}</th><th>{t("pricing.new")}</th><th>{t("pricing.difference")}</th><th>{t("pricing.vat")}</th><th>{t("pricing.large")}</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.storefrontId + row.skuId}>
        <td>{names[row.skuId] ?? row.skuId}</td><td>{row.previous?.kind === "SET" ? formatPrice(row.previous.basePriceMinor!) : t("pricing.no_price")}</td>
        <td>{row.kind === "WITHDRAWN" ? t("pricing.withdraw") : formatPrice(row.basePriceMinor!)}</td>
        <td>{row.deltaMinor === null ? "—" : `${formatPrice(row.deltaMinor)} (${((row.differenceRatio ?? 0) * 100).toLocaleString("ka-GE", { maximumFractionDigits: 2 })}%)`}</td>
        <td>{t(row.vatIncluded ? "pricing.yes" : "pricing.no")}</td><td>{row.unchanged ? t("pricing.unchanged") : row.largeChange ? t("pricing.large") : "—"}</td>
      </tr>)}
    </tbody></table></div>
    <fieldset disabled={busy}><label>{t("pricing.reason")} <textarea value={reason} maxLength={1000} required={needsReason} onChange={(event) => setReason(event.target.value)} /></label>
      {large ? <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t("pricing.confirm_large")}</label> : null}
      <button type="button" disabled={!rows.some((row) => !row.unchanged) || (needsReason && !reason.trim()) || (large && !confirmed)} onClick={() => onCommit(reason.trim() || undefined, confirmed)}>{t("pricing.confirm")}</button>
      <button type="button" onClick={onCancel}>{t("pricing.cancel")}</button>
    </fieldset>
  </section>;
}

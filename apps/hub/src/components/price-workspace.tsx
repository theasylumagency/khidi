"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@khidi/i18n";
import { formatPrice, parsePriceInput, priceInputValue } from "@khidi/pricing/format";
import { createUuidV7 } from "@khidi/shared/uuid";
import { PricePreview, previewChanges, type PricePreviewRow } from "./price-preview.tsx";
import "./pricing.css";

interface WorkspaceRow { skuId: string; code: string; name: string; amount: number | null; vatIncluded: boolean | null; expectedPriceId: string | null; setAt: string | null; author: string }
interface Edit { input: string; kind: "SET" | "WITHDRAWN"; vat: string }
export function PriceWorkspace({ storefrontId, stores, rows, canEdit, admin, defaultVat }: {
  storefrontId: string; stores: { id: string; label: string }[]; rows: WorkspaceRow[]; canEdit: boolean; admin: boolean; defaultVat: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [preview, setPreview] = useState<PricePreviewRow[] | null>(null);
  const [source, setSource] = useState<"MANUAL" | "BULK">("BULK");
  const [copyFrom, setCopyFrom] = useState(stores.find((row) => row.id !== storefrontId)?.id ?? "");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const names = Object.fromEntries(rows.map((row) => [row.skuId, row.code + " · " + row.name]));
  const editFor = (row: WorkspaceRow): Edit => edits[row.skuId] ?? { input: row.amount === null ? "" : priceInputValue(row.amount), kind: "SET", vat: "" };
  const update = (row: WorkspaceRow, patch: Partial<Edit>) => {
    setEdits((before) => ({ ...before, [row.skuId]: { ...editFor(row), ...patch } }));
    setSelected((before) => new Set(before).add(row.skuId));
  };
  async function send(payload: unknown, key?: string) {
    const response = await fetch("/api/prices", { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? t("scanning.error"));
    return body;
  }
  async function prepare(copy = false) {
    setMessage("");
    if (!selected.size) { setMessage(t("pricing.invalid")); return; }
    setBusy(true);
    try {
      const nextSource = copy || selected.size > 1 ? "BULK" : "MANUAL";
      const changes = copy ? [] : rows.filter((row) => selected.has(row.skuId)).map((row) => {
        const edit = editFor(row), amount = parsePriceInput(edit.input);
        if (edit.kind === "SET" && amount === null) throw new Error(t("pricing.invalid"));
        return { skuId: row.skuId, storefrontId, kind: edit.kind, ...(edit.kind === "SET" ? { basePriceMinor: amount! } : {}),
          ...(edit.vat ? { vatIncluded: edit.vat === "true" } : {}), expectedPriceId: row.expectedPriceId };
      });
      const body = await send(copy ? { action: "copy-preview", sourceStorefrontId: copyFrom, targetStorefrontId: storefrontId, skuIds: [...selected] }
        : { action: "preview", batch: { changes, source: nextSource } });
      setSource(nextSource); setPreview(body.preview); setRequestKey(createUuidV7());
    } catch (error) { setMessage(error instanceof Error ? error.message : t("scanning.error")); }
    finally { setBusy(false); }
  }
  async function commit(reason: string | undefined, confirmLargeChanges: boolean) {
    if (!preview) return;
    setBusy(true); setMessage("");
    try {
      await send({ action: "commit", batch: { changes: previewChanges(preview), source, reason, confirmLargeChanges } }, requestKey);
      setPreview(null); setEdits({}); setSelected(new Set()); setMessage(t("pricing.saved")); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : t("scanning.error")); }
    finally { setBusy(false); }
  }
  return <>
    {preview ? <PricePreview key={requestKey} rows={preview} names={names} busy={busy} onCommit={(reason, confirmed) => void commit(reason, confirmed)} onCancel={() => setPreview(null)} /> : <>
      <fieldset disabled={busy}><div style={{ overflowX: "auto" }}><table><thead><tr>
        {canEdit ? <th>{t("pricing.select")}</th> : null}<th>{t("pricing.product")}</th><th>{t("pricing.current")}</th>
        {canEdit ? <><th>{t("pricing.new")}</th><th>{t("pricing.difference")}</th></> : null}<th>{t("pricing.vat")}</th><th>{t("pricing.changed")}</th><th>{t("pricing.author")}</th>
      </tr></thead><tbody>{rows.map((row) => { const edit = editFor(row), amount = parsePriceInput(edit.input), delta = amount !== null && row.amount ? amount - row.amount : null; return <tr key={row.skuId}>
        {canEdit ? <td><input aria-label={t("pricing.select") + " " + row.code} type="checkbox" checked={selected.has(row.skuId)} onChange={(event) => setSelected((before) => { const next = new Set(before); if (event.target.checked) next.add(row.skuId); else next.delete(row.skuId); return next; })} /></td> : null}
        <td><Link href={`/products/${row.skuId}`}>{row.code}</Link><div>{row.name}</div></td><td>{row.amount === null ? t("pricing.no_price") : formatPrice(row.amount)}</td>
        {canEdit ? <><td><select aria-label={t("pricing.new") + " " + row.code} value={edit.kind} onChange={(event) => update(row, { kind: event.target.value as Edit["kind"] })}><option value="SET">{t("pricing.set")}</option><option value="WITHDRAWN">{t("pricing.withdraw")}</option></select>
          <input aria-label={t("pricing.new") + " " + row.code} inputMode="decimal" value={edit.input} disabled={edit.kind === "WITHDRAWN"} onChange={(event) => update(row, { input: event.target.value })} /></td>
          <td>{edit.kind === "SET" && delta !== null ? `${formatPrice(delta)} (${(delta / row.amount! * 100).toLocaleString("ka-GE", { maximumFractionDigits: 2 })}%)` : "—"}</td></> : null}
        <td>{row.amount === null ? "—" : t(row.vatIncluded ? "pricing.yes" : "pricing.no")}{admin && canEdit ? <select aria-label={t("pricing.vat") + " " + row.code} value={edit.vat} onChange={(event) => update(row, { vat: event.target.value })}><option value="">{t("pricing.default_vat")} ({t(defaultVat ? "pricing.yes" : "pricing.no")})</option><option value="true">{t("pricing.yes")}</option><option value="false">{t("pricing.no")}</option></select> : null}</td>
        <td>{row.setAt ? new Date(row.setAt).toLocaleString("ka-GE", { timeZone: "Asia/Tbilisi" }) : "—"}</td><td>{row.author || "—"}</td>
      </tr>; })}</tbody></table></div>
      {canEdit ? <div className="price-actions"><button type="button" onClick={() => void prepare()}>{t("pricing.preview")}</button>
        <label>{t("pricing.copy_from")} <select value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}>{stores.filter((row) => row.id !== storefrontId).map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
        <button type="button" disabled={!copyFrom} onClick={() => void prepare(true)}>{t("pricing.copy")}</button></div> : null}
      </fieldset>
    </>}
    <p role="status">{busy ? t("pricing.loading") : message}</p>
  </>;
}

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t, type TranslationKey } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import type { EvidenceFieldOption } from "@khidi/evidence";

type FactValue = string | boolean | number;
interface Item {
  id: string; type: string; status: string; sensitivity: string; strength: string; notes: string | null;
  supplierName: string | null; documentNumber: string | null; lineText: string | null; quantity: number | null;
  claims: Record<string, FactValue>; attachment: boolean; imageId: string | null;
}
interface Field {
  fieldName: string; status: string; value: FactValue | null; notDeterminableReason: string | null; evidenceIds: string[];
}

export function EvidenceReview({ skuId, kind, items, fields, distinguishing, photoUrls, productTypes, productTypeId, editableType, fieldOptions }: {
  skuId: string; kind: string; items: Item[]; fields: Field[]; distinguishing: string[]; photoUrls: Record<string, string>;
  productTypes: { id: string; nameKa: string }[]; productTypeId: string | null; editableType: boolean;
  fieldOptions: EvidenceFieldOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function send(event: FormEvent<HTMLFormElement>, action: Record<string, unknown>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const manualField = fieldOptions.find((field) => field.key === data.get("manualField"));
    const manualValue = String(data.get("manualValue") ?? "").trim();
    const claims = action.claims && manualField && manualValue ? {
      ...(action.claims as Record<string, FactValue>),
      [manualField.key]: manualField.dataType === "number" ? Number(manualValue)
        : manualField.dataType === "boolean" ? manualValue === "true" : manualValue
    } : action.claims;
    if (manualField?.dataType === "boolean" && manualValue && !["true", "false"].includes(manualValue)) {
      setMessage(t("evidence.error")); return;
    }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/evidence", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": createUuidV7() },
        body: JSON.stringify({ ...action, claims, reason: data.get("reason"), ...(submitter?.value ? { status: submitter.value } : {}),
          ...(action.action === "distinguishing" ? { fields: data.getAll("distinguishing") } : {}),
          ...(data.get("evidenceId") ? { evidenceId: data.get("evidenceId") } : {}),
          ...(data.get("productTypeId") ? { productTypeId: data.get("productTypeId") } : {}),
          ...(data.get("documentNumber") ? { documentNumber: data.get("documentNumber") } : {}),
          ...(data.get("lineText") ? { lineText: data.get("lineText") } : {}),
          ...(data.get("quantity") ? { quantity: Number(data.get("quantity")) } : {}) }) });
      if (!response.ok) throw new Error();
      setMessage(t("evidence.saved")); router.refresh();
    } catch { setMessage(t("evidence.error")); }
    finally { setBusy(false); }
  }
  return <>
    {editableType ? <form onSubmit={(event) => void send(event, { action: "classify", skuId })}>
      <label>{t("evidence.product_type")} <select name="productTypeId" defaultValue={productTypeId ?? ""} required>
        <option value="">—</option>{productTypes.map((type) => <option value={type.id} key={type.id}>{type.nameKa}</option>)}
      </select></label>
      <label>{t("evidence.reason")} <input name="reason" required maxLength={4000} /></label>
      <button disabled={busy}>{t("evidence.save")}</button>
    </form> : null}
    {productTypeId ? <details><summary>{t("evidence.distinguishing")}</summary>
      <form onSubmit={(event) => void send(event, { action: "distinguishing", productTypeId })}>
        <fieldset>
          {fieldOptions.filter((field) => !["brand", "model_code", "manufacturer", "product_type"].includes(field.key)).map((field) =>
            <label key={field.key}><input type="checkbox" name="distinguishing" value={field.key} defaultChecked={distinguishing.includes(field.key)} /> {field.label}</label>)}
        </fieldset>
        <label>{t("evidence.reason")} <input name="reason" required maxLength={4000} /></label>
        <button disabled={busy}>{t("evidence.save")}</button>
      </form></details> : null}
    <form onSubmit={(event) => void send(event, { action: "identity-kind", skuId, kind: kind === "HOUSE_DEFINED" ? "MANUFACTURER_IDENTIFIED" : "HOUSE_DEFINED" })}>
      <label>{t("evidence.reason")} <input name="reason" required maxLength={4000} /></label>
      <button disabled={busy}>{t(kind === "HOUSE_DEFINED" ? "evidence.set_manufacturer" : "evidence.set_house")}</button>
    </form>
    <h3>{t("evidence.fields")}</h3>
    <table><thead><tr><th>{t("evidence.field")}</th><th>{t("evidence.value")}</th><th>{t("evidence.status")}</th><th>{t("evidence.review")}</th></tr></thead>
      <tbody>{[...new Set([...distinguishing, ...fields.map((field) => field.fieldName)])].map((key) => {
        const field = fields.find((value) => value.fieldName === key);
        const medium = items.filter((item) => item.status === "ACCEPTED" && item.strength === "MEDIUM" && Object.hasOwn(item.claims, key));
        const canMarkUndetermined = distinguishing.includes(key) && field?.status !== "VERIFIED";
        const conflicts = field?.status === "CONFLICT" ? items.filter((item) => field.evidenceIds.includes(item.id)) : [];
        return <tr key={key}><th scope="row">{key}</th><td>{field?.value == null ? "—" : String(field.value)}
          {conflicts.length ? <ul>{conflicts.map((item) => <li key={item.id}>{t(`evidence.type.${item.type}` as TranslationKey)} · {String(item.claims[key] ?? "—")}</li>)}</ul> : null}
        </td><td>{t(`evidence.status.${field?.status ?? "NOT_FOUND"}` as TranslationKey)}{field?.notDeterminableReason ? <p>{field.notDeterminableReason}</p> : null}</td>
          <td>{medium.length || canMarkUndetermined ? <form onSubmit={(event) => void send(event, { action: "field", skuId, field: key })}>
            <select name="evidenceId" aria-label={t("evidence.review")} required={!canMarkUndetermined}>
              {canMarkUndetermined ? <option value="">{t("evidence.not_determinable")}</option> : <option value="">—</option>}
              {medium.map((item) => <option key={item.id} value={item.id}>{t(`evidence.type.${item.type}` as TranslationKey)} · {String(item.claims[key])}</option>)}
            </select>
            <input name="reason" aria-label={t("evidence.reason")} placeholder={t("evidence.reason")} required maxLength={4000} />
            <button disabled={busy}>{t("evidence.save")}</button>
          </form> : null}</td></tr>;
      })}</tbody>
    </table>
    <h3>{t("evidence.items")}</h3>
    {items.map((item) => <details key={item.id}>
      <summary>{t(`evidence.type.${item.type}` as TranslationKey)} · {t(`evidence.status.${item.status}` as TranslationKey)}</summary>
      <p>{[item.notes, item.supplierName, item.documentNumber, item.lineText, item.quantity].filter((value) => value !== null).join(" · ")}</p>
      <ul>{Object.entries(item.claims).map(([key, value]) => <li key={key}>{key} · {String(value)}</li>)}</ul>
      {item.attachment ? <a href={`/api/evidence?skuId=${skuId}&attachment=${item.id}`}>{t("evidence.photo")}</a>
        : item.imageId && photoUrls[item.imageId] ? <a href={photoUrls[item.imageId]}>{t("evidence.photo")}</a> : null}
      <form onSubmit={(event) => void send(event, { action: "review", evidenceId: item.id, claims: item.claims })}>
        {item.status !== "ACCEPTED" && item.type !== "MEASUREMENT" ? <>
          <label>{t("evidence.reading_field")} <select name="manualField">
            <option value="">—</option>{fieldOptions.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
          </select></label>
          <label>{t("evidence.reading_value")} <input name="manualValue" maxLength={400} /></label>
        </> : null}
        {item.type === "SUPPLIER_DOCUMENT" ? <>
          <label>{t("evidence.document_number")} <input name="documentNumber" defaultValue={item.documentNumber ?? ""} maxLength={200} /></label>
          <label>{t("evidence.line_text")} <input name="lineText" defaultValue={item.lineText ?? ""} maxLength={4000} /></label>
          <label>{t("evidence.quantity")} <input name="quantity" defaultValue={item.quantity ?? ""} type="number" min={1} step={1} /></label>
        </> : null}
        <label>{t("evidence.reason")} <input name="reason" required maxLength={4000} /></label>
        <button disabled={busy || item.status === "ACCEPTED"} value="ACCEPTED">{t("evidence.accept_reading")}</button>
        <button disabled={busy || item.status === "REJECTED"} value="REJECTED">{t("evidence.reject")}</button>
      </form>
    </details>)}
    <p role="status">{message}</p>
  </>;
}

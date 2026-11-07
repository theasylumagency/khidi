"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t, type TranslationKey } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import type { EvidenceFieldOption } from "@khidi/evidence";
import type { EvidenceClaimSource } from "@khidi/db";

type FactValue = string | boolean | number;
interface Item {
  id: string; type: string; status: string; sensitivity: string; strength: string; notes: string | null;
  skuId: string;
  supplierName: string | null; documentNumber: string | null; lineText: string | null; quantity: number | null;
  claims: Record<string, FactValue>; claimSources: Record<string, EvidenceClaimSource>;
  attachmentUrl: string | null; privateMimeType: string | null; imageId: string | null;
  supersedesEvidenceId: string | null;
  comparisonSkuId: string | null; comparisonPhotoUrl: string | null; comparisonClaims: Record<string, FactValue> | null;
  comparisonRelation:string;acknowledgedUnknowns:Record<string,string>;
}
interface Field {
  fieldName: string; status: string; value: FactValue | null; notDeterminableReason: string | null; evidenceIds: string[];
}

export function EvidenceReview({ skuId, kind, items, fields, distinguishing, photoUrls, productTypes, productTypeId, editableType, fieldOptions, incomingComparisons }: {
  skuId: string; kind: string; items: Item[]; fields: Field[]; distinguishing: string[]; photoUrls: Record<string, string>;
  productTypes: { id: string; nameKa: string }[]; productTypeId: string | null; editableType: boolean;
  fieldOptions: EvidenceFieldOption[];
  incomingComparisons: { id: string; skuId: string }[];
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
    const comparedValue = String(data.get("comparedValue") ?? "").trim();
    const typedValue = (value: string) => manualField?.dataType === "number" ? Number(value)
      : manualField?.dataType === "boolean" ? value === "true" : value;
    const claims = action.claims && manualField && manualValue
      ? { ...(action.claims as Record<string, FactValue>), [manualField.key]: typedValue(manualValue) } : action.claims;
    const comparisonClaims = action.comparisonClaims && manualField && comparedValue
      ? { ...(action.comparisonClaims as Record<string, FactValue>), [manualField.key]: typedValue(comparedValue) } : action.comparisonClaims;
    if (manualField?.dataType === "boolean" && [manualValue, comparedValue].some((value) => value && !["true", "false"].includes(value))) {
      setMessage(t("evidence.error")); return;
    }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/evidence", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": createUuidV7() },
        body: JSON.stringify({ ...action, claims, comparisonClaims, reason: data.get("reason"), ...(submitter?.value ? { status: submitter.value } : {}),
          ...(action.action === "distinguishing" ? { fields: data.getAll("distinguishing") } : {}),
          ...(action.action === "register-observable" ? { key: data.get("fieldKey"), labelKa: data.get("labelKa"),
            labelEn: data.get("labelEn"), dataType: data.get("dataType") } : {}),
          ...(action.action === "review" ? { confirmedAiFields: data.getAll("confirmedAiField") } : {}),
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
    {productTypeId ? <details><summary>{t("evidence.observable_register")}</summary>
      <form onSubmit={(event) => void send(event, { action: "register-observable", productTypeId })}>
        <label>{t("evidence.attribute_key")} <input name="fieldKey" required pattern="[a-z][a-z0-9_]{0,63}" /></label>
        <label>{t("evidence.attribute_label_ka")} <input name="labelKa" required maxLength={120} /></label>
        <label>{t("evidence.attribute_label_en")} <input name="labelEn" required maxLength={120} /></label>
        <label>{t("evidence.value_type")} <select name="dataType">
          <option value="string">{t("evidence.value_text")}</option>
          <option value="number">{t("evidence.value_number")}</option>
          <option value="boolean">{t("evidence.value_boolean")}</option>
        </select></label>
        <label>{t("evidence.reason")} <input name="reason" required maxLength={4000} /></label>
        <button disabled={busy}>{t("evidence.save")}</button>
      </form>
    </details> : null}
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
          {field?.evidenceIds.map((id) => {
            const source = incomingComparisons.find((item) => item.id === id);
            return <p key={id}><a href={`${source ? `/products/${source.skuId}` : ""}#evidence-${id}`}>{t("evidence.source")}</a></p>;
          })}
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
    {items.map((item) => <details key={item.id} id={`evidence-${item.id}`}>
      <summary>{t(`evidence.type.${item.type}` as TranslationKey)} · {t(`evidence.status.${item.status}` as TranslationKey)}</summary>
      <p>{[item.notes, item.supplierName, item.documentNumber, item.lineText, item.quantity].filter((value) => value !== null).join(" · ")}</p>
      {item.supersedesEvidenceId ? <a href={`#evidence-${item.supersedesEvidenceId}`}>{t("evidence.previous_evidence")}</a> : null}
      {item.skuId !== skuId ? <p><a href={`/products/${item.skuId}#evidence-${item.id}`}>{t("merge.original_evidence")}</a></p> : null}
      <ul>{Object.entries(item.claims).filter(([key]) => item.claimSources[key]?.origin !== "AI")
        .map(([key, value]) => <li key={key}>{key} · {String(value)}</li>)}</ul>
      {item.attachmentUrl ? <a href={item.attachmentUrl}>{t(item.privateMimeType === "application/pdf" ? "evidence.open_pdf" : "evidence.photo")}</a>
        : item.imageId && photoUrls[item.imageId] ? <a href={photoUrls[item.imageId]}>{t("evidence.photo")}</a> : null}
      {item.comparisonSkuId ? <div>
        <p>{t(item.comparisonRelation==="MATCHES"?"correction.matches":"correction.differs")}</p>
        {Object.entries(item.acknowledgedUnknowns).map(([field,reason])=><p key={field}>{field} · {t("correction.unknowns")} · {reason}</p>)}
        <a href={`/products/${item.comparisonSkuId}`}>{t("evidence.compared_sku")}</a>
        {item.comparisonPhotoUrl ? <p><a href={item.comparisonPhotoUrl}>{t("evidence.compared_verified_photo")}</a></p> : null}
        <ul>{Object.entries(item.comparisonClaims ?? {}).map(([field, value]) => <li key={field}>{field} · {String(value)}</li>)}</ul>
      </div> : null}
      <form onSubmit={(event) => void send(event, { action: "review", evidenceId: item.id, claims: item.claims,
        comparisonClaims: item.comparisonClaims ?? undefined })}>
        {Object.values(item.claimSources).some((source) => source.origin === "AI") ? <fieldset>
          <legend>{t(item.status === "ACCEPTED" ? "evidence.ai_readings" : "evidence.ai_review_readings")}</legend>
          {item.status !== "ACCEPTED" ? <p>{t("evidence.ai_drop_unconfirmed")}</p> : null}
          {Object.entries(item.claims).filter(([key]) => item.claimSources[key]?.origin === "AI").map(([key, value]) =>
            item.status === "ACCEPTED" ? <p key={key}>{key} · {String(value)}</p> : <div key={key}>
              <label><input type="checkbox" name="confirmedAiField" value={key} /> {t("evidence.confirm_ai_reading")} · {key} · {String(value)}</label>
            </div>
          )}
        </fieldset> : null}
        {item.skuId === skuId && item.status === "PENDING" && item.type !== "MEASUREMENT" ? <>
          <label>{t("evidence.reading_field")} <select name="manualField">
            <option value="">—</option>{fieldOptions.filter((field) => item.claimSources[field.key]?.origin !== "AI"
              && (item.type !== "ADMIN_PHYSICAL_INSPECTION" || field.observable))
              .map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
          </select></label>
          <label>{t("evidence.reading_value")} <input name="manualValue" maxLength={400} /></label>
          {item.comparisonClaims ? <label>{t("evidence.compared_value")} <input name="comparedValue" maxLength={400} /></label> : null}
        </> : null}
        {item.skuId === skuId && item.status === "PENDING" && item.type === "SUPPLIER_DOCUMENT" ? <>
          <label>{t("evidence.document_number")} <input name="documentNumber" defaultValue={item.documentNumber ?? ""} maxLength={200} /></label>
          <label>{t("evidence.line_text")} <input name="lineText" defaultValue={item.lineText ?? ""} maxLength={4000} /></label>
          <label>{t("evidence.quantity")} <input name="quantity" defaultValue={item.quantity ?? ""} type="number" min={1} step={1} /></label>
        </> : null}
        {item.skuId === skuId && item.status !== "REJECTED" ? <>
          <label>{t("evidence.reason")} <input name="reason" required maxLength={4000} /></label>
          {item.status === "PENDING" ? <button disabled={busy} value="ACCEPTED">{t("evidence.accept_reading")}</button> : null}
          <button disabled={busy} value="REJECTED">{t("evidence.reject")}</button>
        </> : null}
      </form>
    </details>)}
    <p role="status">{message}</p>
  </>;
}

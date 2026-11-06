"use client";

import { useRef, useState, type FormEvent } from "react";
import { t, type TranslationKey } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import { useRouter } from "next/navigation";
import type { EvidenceFieldOption } from "@khidi/evidence";
import { allowsEvidencePdf } from "@khidi/evidence/rules";

const taskTypes = ["PACKAGING_PHOTO", "PRODUCT_MARKING_PHOTO", "SUPPLIER_DOCUMENT", "MEASUREMENT"];
const adminTypes = [...taskTypes, "PRODUCT_PLATE_PHOTO", "PASSPORT_MANUAL", "FACTORY_SPEC_SHEET", "ADMIN_PHYSICAL_INSPECTION",
  "CUSTOMS_DECLARATION", "SUPPLIER_CORRESPONDENCE", "SUPPLIER_CATALOG", "STAFF_STATEMENT", "PUBLIC_WEB"];

export function EvidenceCapture({ skuId, taskId, fields, images = [], comparisons = [], replaceable = [] }: {
  skuId: string; taskId?: string; fields: EvidenceFieldOption[];
  images?: { id: string; label: string }[]; comparisons?: { id: string; internalSku: string }[];
  replaceable?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState(taskTypes[0]!), [chosen, setChosen] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [supersedesEvidenceId, setSupersedesEvidenceId] = useState("");
  const key = useRef(createUuidV7());
  const options = kind === "MEASUREMENT" ? fields.filter((field) => field.dataType === "number" && field.unit) : fields;
  const usesFile = taskId && kind !== "MEASUREMENT";
  const allowsPdf = !taskId && allowsEvidencePdf(kind);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget, data = new FormData(form);
    const attachment = data.get("photo");
    const hasAttachment = attachment instanceof File && !!attachment.name;
    const read = (name: string) => String(data.get(name) ?? "").trim() || undefined;
    const claims = Object.fromEntries(chosen.flatMap((field, index) => {
      const definition = options.find((option) => option.key === field), value = read(`value-${index}`);
      if (!definition || value === undefined) return [];
      return [[field, definition.dataType === "number" ? Number(value) : definition.dataType === "boolean" ? value === "true" : value]];
    }));
    const payload = { action: "submit", skuId, taskId, type: kind, claims, notes: read("notes"),
      imageId: hasAttachment ? undefined : read("imageId"), comparisonSkuId: read("comparisonSkuId"), supplierName: read("supplierName"),
      documentNumber: read("documentNumber"), lineText: read("lineText"), quantity: read("quantity") ? Number(read("quantity")) : undefined,
      measurementUnit: kind === "MEASUREMENT" ? options.find((field) => field.key === chosen[0])?.unit : undefined,
      measurementMethod: read("measurementMethod"), supersedesEvidenceId: supersedesEvidenceId || undefined,
      supersessionReason: supersedesEvidenceId ? read("supersessionReason") : undefined };
    const body = new FormData();
    body.set("evidence", JSON.stringify(payload));
    if (hasAttachment) body.set("photo", attachment);
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/evidence", { method: "POST", headers: { "Idempotency-Key": key.current }, body });
      if (!response.ok) throw new Error();
      key.current = createUuidV7(); form.reset(); setChosen([""]); setSupersedesEvidenceId(""); setMessage(t("evidence.saved")); router.refresh();
    } catch { setMessage(t("evidence.error")); }
    finally { setBusy(false); }
  }
  return <form className="office-login" onSubmit={(event) => void submit(event)}>
    <fieldset disabled={busy}>
      {replaceable.length ? <>
        <label>{t("evidence.replaces")} <select value={supersedesEvidenceId} onChange={(event) => setSupersedesEvidenceId(event.target.value)}>
          <option value="">—</option>{replaceable.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        {supersedesEvidenceId ? <label>{t("evidence.replacement_reason")} <input name="supersessionReason" required maxLength={4000} /></label> : null}
      </> : null}
      <label>{t("evidence.type")}<select value={kind} onChange={(event) => { setKind(event.target.value); setChosen([""]); }}>
        {(taskId ? taskTypes : adminTypes).map((type) => <option key={type} value={type}>{t(`evidence.type.${type}` as TranslationKey)}</option>)}
      </select></label>
      <label>{t(allowsPdf ? "evidence.photo_or_pdf" : "evidence.photo")}
        <input key={kind} name="photo" type="file" accept={allowsPdf ? "image/jpeg,image/png,image/webp,application/pdf" : "image/jpeg,image/png,image/webp"}
          capture={allowsPdf ? undefined : "environment"} required={!!usesFile} />
      </label>
      {!taskId && images.length ? <label>{t("evidence.existing_photo")}<select name="imageId">
        <option value="">—</option>{images.map((image) => <option key={image.id} value={image.id}>{image.label}</option>)}
      </select></label> : null}
      {(!taskId || kind === "MEASUREMENT") && chosen.map((field, index) => {
        const option = options.find((candidate) => candidate.key === field);
        return <div key={index}>
          <label>{t("evidence.field")}<select value={field} required={kind === "MEASUREMENT"} onChange={(event) => setChosen(chosen.map((value, i) => i === index ? event.target.value : value))}>
            <option value="">—</option>{options.filter((entry) => entry.key === field || !chosen.includes(entry.key)).map((entry) =>
              <option key={entry.key} value={entry.key}>{entry.label}{entry.unit ? ` (${entry.unit})` : ""}</option>)}
          </select></label>
          {option ? <label>{t("evidence.value")}{option.values || option.dataType === "boolean"
            ? <select name={`value-${index}`} required><option value="">—</option>{(option.values ?? ["true", "false"]).map((value) => <option key={value}>{value}</option>)}</select>
            : <input name={`value-${index}`} required maxLength={400} type={option.dataType === "number" ? "number" : "text"} step="any" />}</label> : null}
        </div>;
      })}
      {!taskId && kind !== "MEASUREMENT" && chosen.length < fields.length
        ? <button type="button" onClick={() => setChosen([...chosen, ""])}>{t("evidence.add_field")}</button> : null}
      {kind === "MEASUREMENT" ? <label>{t("evidence.measurement_method")}<input name="measurementMethod" required maxLength={4000} /></label> : null}
      {!taskId && kind === "ADMIN_PHYSICAL_INSPECTION" && comparisons.length ? <label>{t("evidence.compared_sku")}<select name="comparisonSkuId">
        <option value="">—</option>{comparisons.map((item) => <option value={item.id} key={item.id}>{item.internalSku}</option>)}
      </select></label> : null}
      {!taskId && ["SUPPLIER_DOCUMENT", "SUPPLIER_CATALOG", "SUPPLIER_CORRESPONDENCE", "CUSTOMS_DECLARATION", "FACTORY_SPEC_SHEET"].includes(kind) ? <>
        <label>{t("evidence.supplier")}<input name="supplierName" maxLength={200} /></label>
        <label>{t("evidence.document_number")}<input name="documentNumber" maxLength={200} /></label>
        <label>{t("evidence.line_text")}<input name="lineText" maxLength={4000} /></label>
        <label>{t("evidence.quantity")}<input name="quantity" type="number" min={1} step={1} /></label>
      </> : null}
      <label>{t("evidence.notes")}<textarea name="notes" maxLength={4000} /></label>
      <button type="submit">{t("evidence.save")}</button>
    </fieldset>
    <p role="status">{message}</p>
  </form>;
}

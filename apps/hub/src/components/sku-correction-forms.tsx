"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import type { EvidenceFieldOption } from "@khidi/evidence";
type Choice = {
    id: string;
    label: string;
};
type Photo = Choice & {
    skuId: string;
    verified: boolean;
};
type Source = Choice & {
    claimSkuId: string;
};
async function sendCorrection(action: string, input: unknown) {
    const result = await fetch("/api/products/corrections", { method: "POST", headers: {
            "Content-Type": "application/json", "Idempotency-Key": createUuidV7()
        }, body: JSON.stringify({ action, input }) });
    if (!result.ok)
        throw new Error();
}
export function SkuSplitForm({ sourceSkuId, targets, fields, photos, evidence, locales }: {
    sourceSkuId: string;
    targets: Choice[];
    fields: EvidenceFieldOption[];
    photos: Photo[];
    evidence: Source[];
    locales: string[];
}) {
    const router = useRouter();
    const [rows, setRows] = useState([{ key: 0, skuId: "" }, { key: 1, skuId: "" }]);
    const [nextKey, setNextKey] = useState(2);
    const [basis, setBasis] = useState<string[]>([]);
    const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
    const selected = fields.filter((field) => basis.includes(field.key));
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || !selected.length)
            return;
        const data = new FormData(event.currentTarget);
        const input = { sourceSkuId, reason: data.get("reason"), targets: rows.map((row) => {
                const prefix = "target-" + row.key + "-";
                return { skuId: row.skuId || undefined,
                    claims: Object.fromEntries(selected.map((field) => {
                        const value = String(data.get(prefix + field.key) ?? "");
                        return [field.key, field.dataType === "number" ? Number(value) : field.dataType === "boolean" ? value === "true" : value];
                    })),
                    supports: Object.fromEntries(selected.filter((field) => !field.observable).map((field) => [field.key, data.getAll(prefix + "support-" + field.key)])),
                    imageId: data.get(prefix + "image") || undefined,
                    evidenceAttributions: data.getAll(prefix + "evidence").map((value) => {
                        const item = evidence[Number(value)]!;
                        return { evidenceId: item.id, claimSkuId: item.claimSkuId };
                    }),
                    copyLocales: data.getAll(prefix + "locale") };
            }) };
        setBusy(true);
        setMessage("");
        try {
            await sendCorrection("split", input);
            setMessage(t("correction.saved"));
            router.refresh();
        }
        catch {
            setMessage(t("correction.failed"));
        }
        finally {
            setBusy(false);
        }
    }
    return <details><summary>{t("correction.split")}</summary>
    <form onSubmit={submit} className="office-login"><fieldset disabled={busy}>
      <p>{t("correction.split_hint")}</p>
      <fieldset><legend>{t("correction.basis")}</legend>{fields.map((field) => <label key={field.key}>
        <input type="checkbox" checked={basis.includes(field.key)} onChange={(event) => setBasis(event.target.checked ? [...basis, field.key] : basis.filter((key) => key !== field.key))}/>{field.label}
      </label>)}</fieldset>
      {rows.map((row, index) => <fieldset key={row.key}>
        <legend>{t("correction.target")} {index + 1}</legend>
        <label>{t("scanning.sku")}<select value={row.skuId} onChange={(event) => setRows(rows.map((current) => current.key === row.key ? { ...current, skuId: event.target.value } : current))}>
          <option value="">{t("correction.new_draft")}</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
        </select></label>
        {selected.map((field) => <div key={field.key}>
          <label>{field.label}{field.unit ? " (" + field.unit + ")" : ""}
            {field.values || field.dataType === "boolean" ? <select name={"target-" + row.key + "-" + field.key} required>
              <option value="">—</option>{(field.values ?? ["true", "false"]).map((value) => <option key={value}>{value}</option>)}
            </select> : <input name={"target-" + row.key + "-" + field.key} required maxLength={400} type={field.dataType === "number" ? "number" : "text"} step="any"/>}
          </label>
          {!field.observable ? <label>{t("correction.support")}<select name={"target-" + row.key + "-support-" + field.key} required multiple>
            {evidence.map((item) => <option key={item.id + item.claimSkuId} value={item.id}>{item.label}</option>)}
          </select></label> : null}
        </div>)}
        {selected.some((field) => field.observable) ? <label>{t("evidence.photo")}<select name={"target-" + row.key + "-image"} required>
          <option value="">—</option>{photos.filter((photo) => photo.verified && (photo.skuId === sourceSkuId || photo.skuId === row.skuId))
                    .map((photo) => <option key={photo.skuId + photo.id} value={photo.id}>{photo.label}</option>)}
        </select></label> : null}
        <label>{t("correction.attribute")}<select name={"target-" + row.key + "-evidence"} multiple>
          {evidence.map((item, index) => <option key={item.id + item.claimSkuId} value={index}>{item.label}</option>)}
        </select></label>
        {locales.length ? <fieldset><legend>{t("correction.copy_content")}</legend>{locales.map((locale) => <label key={locale}>
          <input type="checkbox" name={"target-" + row.key + "-locale"} value={locale}/>{locale.toUpperCase()}
        </label>)}</fieldset> : null}
        {rows.length > 2 ? <button type="button" onClick={() => setRows(rows.filter((current) => current.key !== row.key))}>{t("correction.remove_target")}</button> : null}
      </fieldset>)}
      {rows.length < 10 ? <button type="button" onClick={() => { setRows([...rows, { key: nextKey, skuId: "" }]); setNextKey(nextKey + 1); }}>{t("correction.add_target")}</button> : null}
      <label>{t("evidence.reason")}<textarea name="reason" required maxLength={4000}/></label>
      <button disabled={!selected.length}>{t("correction.split")}</button>
    </fieldset><p role="status">{message}</p></form>
  </details>;
}
export function SkuAttributionForm({ sourceSkuId, targets, assets }: {
    sourceSkuId: string;
    targets: Choice[];
    assets: (Choice & {
        kind: "EVIDENCE" | "IMAGE";
        claimSkuId?: string;
    })[];
}) {
    const router = useRouter();
    const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy)
            return;
        const data = new FormData(event.currentTarget), asset = assets[Number(data.get("asset"))];
        if (!asset)
            return;
        setBusy(true);
        setMessage("");
        try {
            await sendCorrection("attribute", { sourceSkuId, targetSkuId: data.get("target"), kind: asset.kind,
                assetId: asset.id, claimSkuId: asset.claimSkuId, reason: data.get("reason") });
            setMessage(t("correction.saved"));
            router.refresh();
        }
        catch {
            setMessage(t("correction.failed"));
        }
        finally {
            setBusy(false);
        }
    }
    return <details><summary>{t("correction.attribute")}</summary><form onSubmit={submit} className="office-login">
    <fieldset disabled={busy}><p>{t("correction.attribute_hint")}</p>
      <label>{t("correction.target")}<select name="target" required><option value="">—</option>
        {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label>
      <label>{t("correction.asset")}<select name="asset" required><option value="">—</option>
        {assets.map((asset, index) => <option key={index} value={index}>{asset.label}</option>)}</select></label>
      <label>{t("evidence.reason")}<input name="reason" required maxLength={4000}/></label>
      <button>{t("evidence.save")}</button>
    </fieldset><p role="status">{message}</p></form></details>;
}

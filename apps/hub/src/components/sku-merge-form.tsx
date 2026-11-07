"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import type { listSkuMergeTargets } from "@khidi/products";
import type { CorrectionPriceImpact } from "@khidi/pricing";
import { CorrectionPriceImpactPanel } from "./correction-price-impact.tsx";

export function SkuMergeForm({ sourceSkuId, candidates, records, priceImpact }: {
  sourceSkuId: string; candidates: Readonly<Awaited<ReturnType<typeof listSkuMergeTargets>>>;
  records:{id:string;otherSkuId:string;label:string}[];
  priceImpact: CorrectionPriceImpact;
}) {
  const router = useRouter();
  const [targetSkuId, setTargetSkuId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const shared = candidates.find((candidate) => candidate.id === targetSkuId)?.sharedListings ?? [];
  async function merge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const listingChoices = Object.fromEntries(shared.map((store) => [store.id, data.get(store.id)]));
    setBusy(true); setMessage("");
    try {
      const result = await fetch("/api/products/merge", { method: "POST", headers: {
        "Content-Type": "application/json", "Idempotency-Key": createUuidV7()
      }, body: JSON.stringify({ sourceSkuId, targetSkuId, identityConfirmed: data.get("identityConfirmed") === "on",
        samenessEvidenceId:data.get("samenessEvidenceId"),reason: data.get("reason"), listingChoices }) });
      if (!result.ok) throw new Error();
      router.push(`/products/${targetSkuId}`);
      router.refresh();
    } catch { setMessage(t("merge.failed")); }
    finally { setBusy(false); }
  }
  if (!candidates.length) return null;
  return <details><summary>{t("merge.title")}</summary>
    <form className="office-login" onSubmit={merge}>
      <fieldset disabled={busy}>
        <p>{t("merge.hint")}</p>
        <label>{t("merge.target")} <select required value={targetSkuId} onChange={(event) => setTargetSkuId(event.target.value)}>
          <option value="">—</option>
          {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.internalSku} · {candidate.name}</option>)}
        </select></label>
        <label>{t("correction.sameness_record")} <select name="samenessEvidenceId" key={targetSkuId} required>
          <option value="">—</option>{records.filter((record)=>record.otherSkuId===targetSkuId).map((record)=>
            <option key={record.id} value={record.id}>{record.label}</option>)}
        </select></label>
        <p>{t("correction.sameness_hint")}</p>
        {shared.map((store) => <label key={`${targetSkuId}:${store.id}`}>{store.name} · {t("merge.listing_choice")}
          <select name={store.id} required>
            <option value="">—</option>
            <option value="SOURCE">{t("merge.source_listing")} · {t(store.sourceEnabled ? "merge.listing_on" : "merge.listing_off")}</option>
            <option value="TARGET">{t("merge.target_listing")} · {t(store.targetEnabled ? "merge.listing_on" : "merge.listing_off")}</option>
          </select>
        </label>)}
        <CorrectionPriceImpactPanel impact={priceImpact} targets={targetSkuId ? [{ id: targetSkuId, label: candidates.find((row) => row.id === targetSkuId)?.internalSku ?? "" }] : []} />
        <label><input type="checkbox" name="identityConfirmed" required /> {t("merge.confirm_identity")}</label>
        <label>{t("merge.identity_basis")} <input name="reason" required maxLength={4000} /></label>
        <button>{t("merge.submit")}</button>
      </fieldset>
    </form>
    <p role="status">{message}</p>
  </details>;
}

"use client";

import { useState } from "react";
import { t } from "@khidi/i18n";
import { CatalogReviewComparison } from "./catalog-review-comparison.tsx";
import { CatalogDecisionForm } from "./catalog-decision-form.tsx";

export type ReviewTextVersion = { id: string; text: string; label: string };

export function CatalogReviewTextPanel({ productId, field, proposalId, revision, original, versions, initialVersion,
  needsApproval, legacyApproval, continueHref, stayHref }: {
  productId: string; field: "NAME" | "SHORT" | "FULL"; proposalId: string | null; revision: number;
  original: string; versions: ReviewTextVersion[]; initialVersion?: string;
  needsApproval: boolean; legacyApproval: boolean; continueHref?: string; stayHref: string;
}) {
  const [selected, setSelected] = useState(initialVersion ?? versions[0]?.id ?? "");
  const [locked, setLocked] = useState(false);
  const version = versions.find((item) => item.id === selected) ?? versions[0];
  return <div className="review-text-workspace">
    {versions.length > 1 ? <label className="review-version-picker">{t("review.text_version")}
      <select value={version?.id} onChange={(event) => setSelected(event.target.value)} disabled={locked}>
        {versions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label> : null}
    {legacyApproval ? <p className="review-empty-help">{t("review.legacy_approval")}</p>
      : needsApproval ? <p className="review-version-hint">{t("review.edit_needs_approval")}</p> : null}
    <CatalogReviewComparison original={original} proposed={version?.text ?? null}
      proposedLabel="review.selected_text" editable />
    <CatalogDecisionForm key={version?.id ?? "new"} id={proposalId} revision={revision}
      productId={productId} field={field} text={version?.text ?? original} textVersion={version?.id}
      onLockedChange={setLocked} proposedPhotoId={null} currentPhotoId={null} continueHref={continueHref} stayHref={stayHref} />
  </div>;
}

"use client";

import { useMemo, useState } from "react";
import { t, type TranslationKey } from "@khidi/i18n";
import { compareReviewText } from "../lib/catalog-review-diff.ts";
import { CatalogReviewOriginal } from "./catalog-review-original.tsx";

export function CatalogReviewComparison({ original, proposed, proposedLabel = "review.proposed", editable = false }: {
  original: string; proposed: string | null; proposedLabel?: TranslationKey; editable?: boolean;
}) {
  const [highlight, setHighlight] = useState(true);
  const comparison = useMemo(() => compareReviewText(original, proposed ?? ""), [original, proposed]);
  const changed = proposed !== null && original !== proposed;

  return <div className="review-text-workspace">
    {proposed !== null ? <div className="review-comparison-toolbar">
      <label><input type="checkbox" checked={highlight} onChange={(event) => setHighlight(event.target.checked)} />
        {t("review.highlight_changes")}
      </label>
      {highlight && changed ? <p className="review-diff-legend">
        <span data-change="removed">− {t("review.removed")}</span>
        <span data-change="added">+ {t("review.added")}</span>
      </p> : null}
      {!changed ? <p className="review-quiet">{t("review.identical_text")}</p> : null}
    </div> : null}
    <div className="review-comparison">
      {highlight && proposed !== null ? <div>
        <h3>{t("review.original")}</h3>
        <p>{original ? comparison.changes.filter((part) => part.kind !== "added").map((part, index) =>
          part.kind === "removed" ? <del key={index}>{part.text}</del> : <span key={index}>{part.text}</span>
        ) : t("review.no_text")}</p>
      </div> : <CatalogReviewOriginal text={original || t("review.no_text")} />}
      <div className="review-proposal-text">
        <h3>{t(proposedLabel)}</h3>
        <p>{proposed === null ? t("review.no_proposal") : !proposed ? t("review.no_text") : highlight
          ? comparison.changes.filter((part) => part.kind !== "removed").map((part, index) =>
            part.kind === "added" ? <ins key={index}>{part.text}</ins> : <span key={index}>{part.text}</span>)
          : proposed}</p>
      </div>
    </div>
    {proposed !== null ? <p className="review-quiet review-comparison-help">
      {t(highlight && comparison.coarse ? "review.coarse_comparison" : "review.comparison_help")}
    </p> : <p className="review-empty-help">{t(editable ? "review.add_text_help" : "review.no_proposal_help")}</p>}
  </div>;
}

"use client";

import { useId, useState } from "react";
import { t } from "@khidi/i18n";

export function CatalogReviewOriginal({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const textId = useId();
  const preview = text.slice(0, 420).replace(/\s+\S*$/u, "").trimEnd();
  const long = text.length > 520;
  return <div>
    <h3>{t("review.original")}</h3>
    <p id={textId}>{long && !expanded ? `${preview}…` : text}</p>
    {long ? <button type="button" className="review-expand" aria-controls={textId}
      aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {t(expanded ? "review.collapse_original" : "review.expand_original")}
    </button> : null}
  </div>;
}

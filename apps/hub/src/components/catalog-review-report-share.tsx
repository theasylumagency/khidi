"use client";

import { useState } from "react";
import { t } from "@khidi/i18n";

export function CatalogReviewReportShare({ text, emailHref }: { text: string; emailHref: string }) {
  const [copyState, setCopyState] = useState<"copied" | "failed">();
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  return <div className="review-card">
    <div className="review-actions">
      <button type="button" onClick={() => void copy()}>{t("review.checkpoint.copy")}</button>
      <a className="review-button review-primary" href={emailHref}>{t("review.checkpoint.email")}</a>
    </div>
    <p className="review-quiet">{t("review.checkpoint.email_help")}</p>
    {copyState ? <p role="status">{t(`review.checkpoint.${copyState}`)}</p> : null}
  </div>;
}

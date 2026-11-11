"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { t } from "@khidi/i18n";

export function CatalogReviewCheckpoint({ id, viewed }: { id: string; viewed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [failed, setFailed] = useState(false);
  const href = `/review/report/${id}`;

  async function acknowledge(open: boolean) {
    if (busy || acknowledged) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/catalog-review/checkpoint", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id })
      });
      if (!response.ok) throw new Error("Checkpoint acknowledgement failed.");
      setAcknowledged(true);
      if (open) router.push(href);
      else router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (viewed || acknowledged) {
    return <Link className="review-report-link" href={href} prefetch={false}>{t("review.checkpoint.view")}</Link>;
  }
  return <aside className="review-overview">
    <div><strong>{t("review.checkpoint.ready")}</strong>
      <p className="review-quiet">{t("review.checkpoint.continue")}</p></div>
    <div className="review-actions">
      <button type="button" data-primary="true" disabled={busy} onClick={() => void acknowledge(true)}>
        {t("review.checkpoint.view")}
      </button>
      <button type="button" disabled={busy} onClick={() => void acknowledge(false)}>{t("review.checkpoint.later")}</button>
    </div>
    {failed ? <p role="status">{t("review.failed")}</p> : null}
  </aside>;
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@khidi/db";
import { getReviewProduct, reviewId, reviewRoles } from "@khidi/catalog-review";
import { AppError } from "@khidi/shared";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../../lib/session.ts";
import { CatalogDecisionForm } from "../../../components/catalog-decision-form.tsx";

const fields = [
  ["NAME", "არსებული სახელი"],
  ["SHORT", "არსებული მოკლე აღწერა"],
  ["FULL", "არსებული სრული აღწერა"]
] as const;
const date = new Intl.DateTimeFormat("ka-GE", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tbilisi" });

export const dynamic = "force-dynamic";

export default async function ReviewProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const principal = await requirePageAuth({ allowedRoles: [...reviewRoles] });
  const { productId } = await params;
  if (!reviewId.safeParse(productId).success) notFound();
  const result = await getReviewProduct(getDb(), principal, productId).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const { product, proposals, photos, history } = result;
  const byField = new Map(proposals.map((proposal) => [proposal.field, proposal]));
  const rows = [...fields, ["PHOTO", ""] as const];
  const options = photos.map((photo) => ({
    id: photo.id, position: photo.position,
    needsAttention: Boolean(photo.audit.quality_flags),
    url: `/api/catalog-review/photo/${productId}/${photo.id}`
  }));

  return <article className="catalog-review">
    <Link href="/review">← {t("review.back")}</Link>
    <div>
      <h1>{String(product.baseline["არსებული სახელი"] ?? t("review.unnamed"))}</h1>
      <p className="review-quiet">#{product.wordpressId}{product.sourceStatus === "DRAFT" ? ` · ${t("review.DRAFT")}` : ""}</p>
    </div>
    <p className="review-quiet">{t("review.editorial")}</p>
    {rows.map(([field, originalKey]) => {
      const proposal = byField.get(field);
      const current = proposal && history.find((decision) => decision.proposalId === proposal.id);
      return <section className="review-card" key={field}>
        <div className="review-heading">
          <h2>{t(`review.field.${field}`)}</h2>
          {current ? <span>{t(`review.status.${current.action}`)}</span> : null}
        </div>
        {field !== "PHOTO" ? <div className="review-comparison">
          <div><h3>{t("review.original")}</h3><p>{String(product.baseline[originalKey] ?? t("review.no_text"))}</p></div>
          <div><h3>{t("review.proposed")}</h3><p>{proposal?.proposed ?? t("review.no_proposal")}</p></div>
        </div> : null}
        {current?.editedText ? <div className="review-explanation">
          <h3>{t("review.edited_text")}</h3><p className="review-edited-text">{current.editedText}</p>
        </div> : null}
        {proposal ? <>
          <dl className="review-explanation">
            <dt>{t("review.observation")}</dt><dd>{proposal.observation}</dd>
            <dt>{t("review.rationale")}</dt><dd>{proposal.rationale}</dd>
          </dl>
          <CatalogDecisionForm
            key={`${proposal.id}:${current?.revision ?? 0}`}
            id={proposal.id} revision={current?.revision ?? 0}
            text={current?.editedText ?? proposal.proposed}
            proposedPhotoId={proposal.proposedPhotoId} currentPhotoId={current?.photoId ?? null}
            photos={field === "PHOTO" ? options : undefined}
          />
        </> : null}
      </section>;
    })}
    <details className="review-history">
      <summary>{t("review.history")} ({history.length})</summary>
      {history.length ? <ol>
        {[...history].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((decision) => {
          const field = proposals.find((proposal) => proposal.id === decision.proposalId)!.field;
          const photo = options.find((option) => option.id === decision.photoId);
          return <li key={decision.id}>
            <strong>{t(`review.field.${field}`)} · {t(`review.status.${decision.action}`)}</strong>
            <div>{decision.actor} · <time dateTime={decision.createdAt.toISOString()}>{date.format(decision.createdAt)}</time></div>
            {photo ? <p>{t("review.photo_selected")} {photo.position}</p> : null}
            {decision.editedText ? <p>{decision.editedText}</p> : null}
            {decision.note ? <p>{decision.note}</p> : null}
          </li>;
        })}
      </ol> : <p>{t("review.history_empty")}</p>}
    </details>
  </article>;
}

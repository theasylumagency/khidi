import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@khidi/db";
import { getReviewProduct, listReviewCheckpoints, listReviewProducts, reviewId, reviewRoles } from "@khidi/catalog-review";
import { AppError } from "@khidi/shared";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../../lib/session.ts";
import { nextReviewProduct, orderReviewQueue, readReviewFilters, reviewHref } from "../../../lib/catalog-review-navigation.ts";
import { CatalogDecisionForm } from "../../../components/catalog-decision-form.tsx";
import { CatalogReviewOriginal } from "../../../components/catalog-review-original.tsx";
import { CatalogReviewCheckpoint } from "../../../components/catalog-review-checkpoint.tsx";

const fields = [
  { field: "NAME", view: "name", source: "არსებული სახელი" },
  { field: "SHORT", view: "short", source: "არსებული მოკლე აღწერა" },
  { field: "FULL", view: "full", source: "არსებული სრული აღწერა" },
  { field: "PHOTO", view: "photos", source: "" }
] as const;
const date = new Intl.DateTimeFormat("ka-GE", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tbilisi" });

export const dynamic = "force-dynamic";

export default async function ReviewProductPage({ params, searchParams }: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [principal, { productId }, paramsFromUrl] = await Promise.all([
    requirePageAuth({ allowedRoles: [...reviewRoles] }), params, searchParams
  ]);
  const { view } = paramsFromUrl;
  const filters = readReviewFilters(paramsFromUrl);
  if (!reviewId.safeParse(productId).success) notFound();

  const db = getDb();
  const [result, queue, reports] = await Promise.all([
    getReviewProduct(db, principal, productId).catch((error: unknown) => {
      if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
    listReviewProducts(db, principal),
    listReviewCheckpoints(db, principal)
  ]);
  const { product, proposals, photos, history } = result;
  const offer = reports.find((report) => report.batchId === product.batchId && !report.viewedAt);
  const options = photos.map((photo) => ({
    id: photo.id, position: photo.position,
    needsAttention: Boolean(photo.audit.quality_flags),
    url: `/api/catalog-review/photo/${productId}/${photo.id}`
  }));
  const sections = fields.map((item) => {
    const proposal = proposals.find((entry) => entry.field === item.field);
    const decisions = proposal ? history.filter((decision) => decision.proposalId === proposal.id) : [];
    const current = decisions.find((decision) => principal.role === "ADMIN" || decision.actorId === principal.userId);
    return { ...item, proposal, current, revision: decisions[0]?.revision ?? 0 };
  });
  const undecided = sections.filter((item) => item.proposal && !item.current);
  const deferred = sections.filter((item) => item.current?.action === "DEFER");
  const requested = sections.find((item) => item.view === view);
  const firstIssue = filters.status === "deferred" ? deferred[0] ?? undecided[0] : undecided[0] ?? deferred[0];
  const active = view === "history" ? undefined
    : requested ?? firstIssue ?? (history.length ? undefined : sections[0]);
  const href = (viewName: string) => reviewHref(filters, productId, viewName);
  const next = nextReviewProduct(orderReviewQueue(queue), productId, filters);
  const completed = proposals.length - undecided.length;
  const nextField = undecided.find((item) => item.field !== active?.field);
  const continueHref = active && !active.current ? href(nextField?.view ?? "history") : undefined;

  return <article className="catalog-review">
    <div className="review-product-header">
      <Link href={reviewHref(filters)} className="review-back">← {t("review.back")}</Link>
      {next ? <Link href={reviewHref(filters, next.id)} className="review-button" prefetch={false}>
        {t("review.next_product")} <span aria-hidden="true">→</span>
      </Link> : null}
      <div className="review-product-title">
        <h1>{String(product.baseline["არსებული სახელი"] ?? t("review.unnamed"))}</h1>
        <p className="review-quiet">#{product.wordpressId}{product.sourceStatus === "DRAFT" ? ` · ${t("review.DRAFT")}` : ""}</p>
      </div>
      <div className="review-progress review-product-progress">
        <label htmlFor="review-progress">{completed} / {proposals.length} {t("review.items_reviewed")}</label>
        <progress id="review-progress" value={completed} max={proposals.length} />
      </div>
    </div>

    {offer ? <CatalogReviewCheckpoint id={offer.id} viewed={false} /> : null}
    <nav className="review-section-nav" aria-label={t("review.sections")}>
      {sections.map((item) => {
        const state = item.current ? `review.status.${item.current.action}` as const
          : item.proposal ? "review.pending" : "review.no_change";
        return <Link key={item.field} href={href(item.view)} prefetch={false}
          aria-current={active?.field === item.field ? "page" : undefined}>
          <span>{t(`review.field.${item.field}`)}</span>
          <small data-state={item.current?.action ?? (item.proposal ? "pending" : "empty")}>{t(state)}</small>
        </Link>;
      })}
      <Link href={href("history")} prefetch={false} aria-current={active ? undefined : "page"}>
        <span>{t("review.history_tab")}</span>
        <small>{history.length} {t("review.decisions")}</small>
      </Link>
    </nav>

    {active ? <section className="review-card">
      <div className="review-heading">
        <h2>{t(`review.field.${active.field}`)}</h2>
        {active.field === "PHOTO" && options.length > 0 ? <p className="review-quiet">{t("review.photo_source")}</p> : null}
      </div>
      {active.proposal ? <dl className="review-explanation">
        <div><dt>{t("review.observation")}</dt><dd>{active.proposal.observation}</dd></div>
        <div><dt>{t("review.rationale")}</dt><dd>{
          active.field !== "PHOTO" || active.proposal.proposedPhotoId ? active.proposal.rationale
            : t(options.length ? "review.photo_review_archive" : "review.photo_defer_archive")
        }</dd></div>
      </dl> : null}
      {active.field !== "PHOTO" ? <div className="review-comparison">
        <CatalogReviewOriginal key={active.field} text={String(product.baseline[active.source] ?? t("review.no_text"))} />
        <div className="review-proposal-text"><h3>{t("review.proposed")}</h3>
          <p>{active.proposal?.proposed ?? t("review.no_proposal")}</p>
        </div>
      </div> : null}
      {active.current?.editedText ? <div className="review-explanation">
        <h3>{t("review.edited_text")}</h3><p className="review-edited-text">{active.current.editedText}</p>
      </div> : null}
      {active.proposal ? <CatalogDecisionForm
        key={`${active.proposal.id}:${active.revision}`}
        id={active.proposal.id} revision={active.revision}
        text={active.current?.editedText ?? active.proposal.proposed}
        proposedPhotoId={active.proposal.proposedPhotoId} currentPhotoId={active.current?.photoId ?? null}
        photos={active.field === "PHOTO" ? options : undefined}
        continueHref={continueHref}
      /> : null}
    </section> : <section className="review-history">
      <h2>{t("review.history")}</h2>
      {history.length ? <ol>
        {[...history].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.revision - a.revision).map((decision) => {
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
    </section>}
    <p className="review-quiet review-editorial">{t("review.editorial")}</p>
  </article>;
}

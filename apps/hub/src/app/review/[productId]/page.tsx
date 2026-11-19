import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@khidi/db";
import { getReviewProduct, listPilot, listReviewCheckpoints, listReviewProducts, reviewId, reviewRoles } from "@khidi/catalog-review";
import { PilotProduct } from "../../../components/catalog-feedback.tsx";
import { AppError } from "@khidi/shared";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../../lib/session.ts";
import { nextReviewProduct, orderReviewQueue, readReviewFilters, reviewHref } from "../../../lib/catalog-review-navigation.ts";
import { CatalogDecisionForm } from "../../../components/catalog-decision-form.tsx";
import { CatalogReviewTextPanel } from "../../../components/catalog-review-text-panel.tsx";
import { CatalogReviewCheckpoint } from "../../../components/catalog-review-checkpoint.tsx";
import { ReviewPhotoStudio, ReviewPhotoHistory } from "../../../components/review-photo-studio.tsx";

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
  const [result, pilot] = await Promise.all([
    getReviewProduct(db, principal, productId).catch((error: unknown) => {
      if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
    listPilot(db, principal)
  ]);
  const card = pilot.find(row => row.id === productId);
  if (card) return <PilotProduct row={card} rows={pilot} result={result}/>;
  const [queue, reports] = await Promise.all([listReviewProducts(db, principal), listReviewCheckpoints(db, principal)]);
  const { product, proposals, photos, history, photoWork } = result;
  const offer = reports.find((report) => report.batchId === product.batchId && !report.viewedAt);
  const options = photos.map((photo) => ({
    id: photo.id, position: photo.position, origin: photo.audit.origin,
    width: Number(photo.audit.width_px) > 0 ? Number(photo.audit.width_px) : null,
    height: Number(photo.audit.height_px) > 0 ? Number(photo.audit.height_px) : null,
    qualityFlags: (photo.audit.quality_flags ?? "").split(";").map((flag) => flag.trim()).filter(Boolean),
    url: `/api/catalog-review/photo/${productId}/${photo.id}`
  }));
  const sections = fields.map((item) => {
    const proposal = proposals.find((entry) => entry.field === item.field);
    const decisions = proposal ? history.filter((decision) => decision.proposalId === proposal.id) : [];
    const current = decisions.find((decision) => principal.role === "ADMIN" || decision.actorId === principal.userId);
    return { ...item, proposal, current, decisions, revision: decisions[0]?.revision ?? 0 };
  });
  const undecided = sections.filter((item) => item.proposal && !item.current);
  const deferred = sections.filter((item) => item.current?.action === "DEFER");
  const photoFilter = filters.status === "uploads" || filters.status === "detailRequests";
  const requested = sections.find((item) => item.view === (view ?? (photoFilter ? "photos" : undefined)));
  const firstIssue = filters.status === "deferred" ? deferred[0] ?? undecided[0] : undecided[0] ?? deferred[0];
  const active = view === "history" ? undefined
    : requested ?? firstIssue ?? (history.length ? undefined : sections[0]);
  const href = (viewName: string) => reviewHref(filters, productId, viewName);
  const next = nextReviewProduct(orderReviewQueue(queue), productId, filters);
  const completed = proposals.length - undecided.length;
  const nextField = undecided.find((item) => item.field !== active?.field);
  const continueHref = active && (!active.current || active.current.action === "EDIT") ? href(nextField?.view ?? "history") : undefined;
  const versions = active?.field !== "PHOTO" && active?.proposal ? [
    ...active.decisions.filter((decision) => decision.editedText !== null).map((decision) => ({
      id: decision.id, text: decision.editedText!,
      label: `${t("review.text_revision")} ${decision.revision} · ${decision.actor} · ${date.format(decision.createdAt)}`
    })),
    ...(active.proposal.origin === "IMPORT" && active.proposal.proposed !== null
      ? [{ id: "PROPOSAL", text: active.proposal.proposed, label: t("review.imported_version") }] : [])
  ] : [];
  const selectedVersion = active?.current?.action === "EDIT" ? active.current.id
    : active?.current?.approvedText != null ? active.current.approvedTextEditId ?? "PROPOSAL"
      : active?.proposal?.origin === "IMPORT" ? "PROPOSAL" : versions[0]?.id;
  const nameDecision = sections.find((item) => item.field === "NAME")?.current;
  const displayName = nameDecision?.approvedText ?? nameDecision?.editedText ?? String(product.baseline["არსებული სახელი"] ?? "");

  return <article className="catalog-review">
    <div className="review-product-header">
      <Link href={reviewHref(filters)} className="review-back">← {t("review.back")}</Link>
      {next ? <Link href={reviewHref(filters, next.id)} className="review-button" prefetch={false}>
        {t("review.next_product")} <span aria-hidden="true">→</span>
      </Link> : null}
      <div className="review-product-title">
        {options[0] ? <Link href={href("photos")} className="review-product-thumbnail" aria-label={t("review.field.PHOTO")}>
          <img src={options[0].url} alt="" width={80} height={80} />
        </Link> : null}
        <div>
          <h1>{displayName.trim() || t("review.unnamed")}</h1>
          <p className="review-quiet">#{product.wordpressId}{product.sourceStatus === "DRAFT" ? ` · ${t("review.DRAFT")}` : ""}</p>
        </div>
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
          : item.proposal ? "review.pending"
            : item.field !== "PHOTO" && !String(product.baseline[item.source] ?? "").trim()
              ? "review.missing_text" : "review.no_proposal_short";
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
      </div>
      {active.proposal?.origin === "IMPORT" ? <details className="review-source-notes">
        <summary>{t("review.import_notes")}</summary>
        <dl className="review-explanation">
          <div><dt>{t("review.observation")}</dt><dd>{active.proposal.observation}</dd></div>
          <div><dt>{t("review.rationale")}</dt><dd>{
            active.field !== "PHOTO" || active.proposal.proposedPhotoId ? active.proposal.rationale
              : t(options.length ? "review.photo_review_archive" : "review.photo_defer_archive")
          }</dd></div>
        </dl>
      </details> : null}
      {active.field !== "PHOTO" ? <CatalogReviewTextPanel key={`${active.field}:${active.revision}`}
        productId={productId} field={active.field} proposalId={active.proposal?.id ?? null} revision={active.revision}
        original={String(product.baseline[active.source] ?? "")} versions={versions} initialVersion={selectedVersion}
        needsApproval={active.current?.action === "EDIT"}
        legacyApproval={active.current?.action === "APPROVE" && active.current.approvedText === null}
        continueHref={continueHref} stayHref={href(active.view)} /> : null}
      {active.field === "PHOTO" && active.proposal ? <CatalogDecisionForm
        key={`${active.proposal.id}:${active.revision}`}
        id={active.proposal.id} revision={active.revision}
        text={active.current?.editedText ?? active.proposal.proposed}
        proposedPhotoId={active.proposal.proposedPhotoId} currentPhotoId={active.current?.photoId ?? null}
        photos={active.field === "PHOTO" ? options : undefined}
        continueHref={continueHref}
      /> : null}
      {active.field === "PHOTO" && !active.proposal && options.length > 0 &&
        <div className="review-photos">{options.map(photo => <figure key={photo.id}>
          <img src={photo.url} alt={`${t("review.photo")} ${photo.position}`} loading="lazy" />
          <figcaption>{t("review.photo")} {photo.position}</figcaption></figure>)}</div>}
      {active.field === "PHOTO" && <ReviewPhotoStudio key={productId} productId={productId} photos={options} activity={photoWork}
        paid={Boolean(process.env.REVIEW_GEMINI_API_KEY)} />}
    </section> : <section className="review-history">
      <h2>{t("review.history")}</h2>
      <ReviewPhotoHistory activity={photoWork} />
      {history.length ? <ol>
        {[...history].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.revision - a.revision).map((decision) => {
          const field = proposals.find((proposal) => proposal.id === decision.proposalId)!.field;
          const photo = options.find((option) => option.id === decision.photoId);
          return <li key={decision.id}>
            <strong>{t(`review.field.${field}`)} · {t(`review.status.${decision.action}`)}</strong>
            <div>{decision.actor} · <time dateTime={decision.createdAt.toISOString()}>{date.format(decision.createdAt)}</time></div>
            {photo ? <p>{t("review.photo_selected")} {photo.position}</p> : null}
            {decision.editedText ? <p>{decision.editedText}</p> : null}
            {decision.approvedText !== null ? <div className="review-approved-snapshot">
              <h3>{t("review.approved_text")}</h3><p>{decision.approvedText}</p>
            </div> : field !== "PHOTO" && decision.action === "APPROVE" ? <p className="review-quiet">{t("review.legacy_approval_history")}</p> : null}
            {decision.note ? <p>{decision.note}</p> : null}
          </li>;
        })}
      </ol> : <p>{t("review.history_empty")}</p>}
    </section>}
    <p className="review-quiet review-editorial">{t("review.editorial")}</p>
  </article>;
}

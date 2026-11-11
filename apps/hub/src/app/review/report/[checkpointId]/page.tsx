import Link from "next/link";
import { notFound } from "next/navigation";
import { getReviewCheckpoint, reviewId } from "@khidi/catalog-review";
import { getDb } from "@khidi/db";
import { t } from "@khidi/i18n";
import { AppError } from "@khidi/shared";
import { requirePageAuth } from "../../../../lib/session.ts";
import { CatalogReviewReportShare } from "../../../../components/catalog-review-report-share.tsx";

const actions = ["APPROVE", "EDIT", "REJECT", "DEFER"] as const;
const date = new Intl.DateTimeFormat("ka-GE", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tbilisi" });
export const dynamic = "force-dynamic";

export default async function ReviewReportPage({ params }: { params: Promise<{ checkpointId: string }> }) {
  const [principal, { checkpointId }] = await Promise.all([
    requirePageAuth({ allowedRoles: ["CATALOG_REVIEWER"] }), params
  ]);
  if (!reviewId.safeParse(checkpointId).success) notFound();
  const checkpoint = await getReviewCheckpoint(getDb(), principal, checkpointId).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const counts = { APPROVE: 0, EDIT: 0, REJECT: 0, DEFER: 0 };
  for (const product of checkpoint.report) for (const item of product.outcomes) counts[item.action]++;
  const title = t("review.checkpoint.title");
  const summary = [
    `${checkpoint.report.length} ${t("review.products_reviewed")}`,
    ...actions.map((action) => `${t(`review.status.${action}`)} — ${counts[action]}`)
  ];
  const plainText = [title, date.format(checkpoint.createdAt), ...summary, "",
    ...checkpoint.report.flatMap((product) => [
      `#${product.wordpressId} ${product.name ?? t("review.unnamed")}`,
      ...product.outcomes.flatMap((item) => [
        `${t(`review.field.${item.field}`)} · ${t(`review.status.${item.action}`)}`,
        ...(item.photoPosition !== null ? [`${t("review.photo_selected")} ${item.photoPosition}`] : []),
        ...(item.editedText ? [item.editedText] : []),
        ...(item.note ? [item.note] : [])
      ]), ""
    ])
  ].join("\n");
  // Only the counts open in the mail draft. The reviewer can paste the detailed report if needed.
  const emailHref = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(summary.join("\n"))}`;

  return <article className="catalog-review">
    <Link className="review-back" href="/review">← {t("review.back")}</Link>
    <h1>{title}</h1>
    <p className="review-quiet"><time dateTime={checkpoint.createdAt.toISOString()}>{date.format(checkpoint.createdAt)}</time></p>
    <dl className="review-report-summary">
      {actions.map((action) => <div key={action}>
        <dt>{t(`review.status.${action}`)}</dt><dd>{counts[action]}</dd>
      </div>)}
    </dl>
    <CatalogReviewReportShare text={plainText} emailHref={emailHref} />
    <section className="review-history">
      <h2>{t("review.checkpoint.products")}</h2>
      <ol>
        {checkpoint.report.map((product) => <li key={product.wordpressId}>
          <h3>{product.name ?? t("review.unnamed")} <small>#{product.wordpressId}</small></h3>
          {product.outcomes.map((item) => <div key={item.field} className="review-report-outcome">
            <strong>{t(`review.field.${item.field}`)} · {t(`review.status.${item.action}`)}</strong>
            {item.photoPosition !== null ? <p>{t("review.photo_selected")} {item.photoPosition}</p> : null}
            {item.editedText ? <p>{item.editedText}</p> : null}
            {item.note ? <p>{item.note}</p> : null}
          </div>)}
        </li>)}
      </ol>
    </section>
  </article>;
}

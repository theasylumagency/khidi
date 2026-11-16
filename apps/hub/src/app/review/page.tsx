import { getDb } from "@khidi/db";
import { listReviewCheckpoints, listReviewProducts, reviewRoles } from "@khidi/catalog-review";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../lib/session.ts";
import { orderReviewQueue, readReviewFilters } from "../../lib/catalog-review-navigation.ts";
import { CatalogReviewQueue } from "../../components/catalog-review-queue.tsx";
import { CatalogReviewCheckpoint } from "../../components/catalog-review-checkpoint.tsx";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [principal, params] = await Promise.all([requirePageAuth({ allowedRoles: [...reviewRoles] }), searchParams]);
  const db = getDb();
  const [products, reports] = await Promise.all([listReviewProducts(db, principal), listReviewCheckpoints(db, principal)]);
  const filters = readReviewFilters(params);

  return <section className="catalog-review">
    <h1>{t("review.title")}</h1>
    {reports.map((report) => <CatalogReviewCheckpoint key={report.id} id={report.id} viewed={Boolean(report.viewedAt)} />)}
    {products.length ? <CatalogReviewQueue key={JSON.stringify(filters)} products={orderReviewQueue(products)} initialFilters={filters} />
      : <p>{t("review.empty")}</p>}
  </section>;
}

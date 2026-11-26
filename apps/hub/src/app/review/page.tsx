import { getDb } from "@khidi/db";
import { listPilot, roundDetails, listReviewCheckpoints, listReviewProducts, reviewRoles } from "@khidi/catalog-review";
import { PilotQueue } from "../../components/catalog-feedback.tsx";
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
  const pilot = await listPilot(db, principal);
  if (pilot.length) return <PilotQueue rows={pilot} details={await roundDetails(db,pilot)} admin={principal.role === "ADMIN"}/>;
  const [products, reports] = await Promise.all([listReviewProducts(db, principal), listReviewCheckpoints(db, principal)]);
  const filters = readReviewFilters(params);

  return <section className="catalog-review">
    <h1>{t("review.title")}</h1>
    {reports.map((report) => <CatalogReviewCheckpoint key={report.id} id={report.id} viewed={Boolean(report.viewedAt)} />)}
    {products.length ? <CatalogReviewQueue key={JSON.stringify(filters)} products={orderReviewQueue(products)} initialFilters={filters} />
      : <p>{t("review.empty")}</p>}
  </section>;
}

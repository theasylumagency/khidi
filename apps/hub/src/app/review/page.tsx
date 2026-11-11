import { getDb } from "@khidi/db";
import { listReviewProducts, reviewRoles } from "@khidi/catalog-review";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../lib/session.ts";
import { orderReviewQueue, readReviewFilters } from "../../lib/catalog-review-navigation.ts";
import { CatalogReviewQueue } from "../../components/catalog-review-queue.tsx";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [principal, params] = await Promise.all([requirePageAuth({ allowedRoles: [...reviewRoles] }), searchParams]);
  const products = await listReviewProducts(getDb(), principal);
  const filters = readReviewFilters(params);

  return <section className="catalog-review">
    <h1>{t("review.title")}</h1>
    {products.length ? <CatalogReviewQueue key={JSON.stringify(filters)} products={orderReviewQueue(products)} initialFilters={filters} />
      : <p>{t("review.empty")}</p>}
  </section>;
}

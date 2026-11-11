import Link from "next/link";
import { getDb } from "@khidi/db";
import { listReviewProducts, reviewRoles } from "@khidi/catalog-review";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../lib/session.ts";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const principal = await requirePageAuth({ allowedRoles: [...reviewRoles] });
  const products = await listReviewProducts(getDb(), principal);
  const ordered = [...products].sort((a, b) => Number(b.pending > 0) - Number(a.pending > 0)
    || Number(b.deferred > 0) - Number(a.deferred > 0) || a.wordpressId - b.wordpressId);

  return <section className="catalog-review">
    <h1>{t("review.title")}</h1>
    {products.length ? <>
      <p className="review-quiet">{t("review.intro")}</p>
      <ul className="review-list">
        {ordered.map((product) => <li key={product.id}>
          <Link href={`/review/${product.id}`}>
            <span><strong>{product.name ?? t("review.unnamed")}</strong><br />
              <small>#{product.wordpressId}{product.sourceStatus === "DRAFT" ? ` · ${t("review.DRAFT")}` : ""}</small>
            </span>
            <small>{product.pending ? `${product.pending} ${t("review.pending")}`
              : product.deferred ? `${product.deferred} ${t("review.deferred")}` : t("review.done")}</small>
          </Link>
        </li>)}
      </ul>
    </> : <p>{t("review.empty")}</p>}
  </section>;
}

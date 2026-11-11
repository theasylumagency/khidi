"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReviewProductSummary } from "@khidi/catalog-review";
import { t } from "@khidi/i18n";
import { matchesReviewScope, reviewFilters, reviewHref, type ReviewFilter, type ReviewQueueFilters } from "../lib/catalog-review-navigation.ts";

export function CatalogReviewQueue({ products, initialFilters }: {
  products: ReviewProductSummary[];
  initialFilters: ReviewQueueFilters;
}) {
  const [query, setQuery] = useState(initialFilters.q);
  const [filter, setFilter] = useState<ReviewFilter>(initialFilters.status);
  const [category, setCategory] = useState(initialFilters.category);
  const categories = [...new Set(products.flatMap((product) => product.category ? [product.category] : []))]
    .sort((a, b) => a.localeCompare(b, "ka"));
  const completed = products.filter((product) => product.pending === 0).length;
  const selection = { q: query, category, status: filter };
  const search = query.trim().replace(/^#/u, "").toLocaleLowerCase("ka");
  const visible = products.filter((product) => {
    return matchesReviewScope(product, category, filter)
      && (!search || (product.name ?? t("review.unnamed")).toLocaleLowerCase("ka").includes(search)
        || String(product.wordpressId).includes(search));
  });
  const resume = visible.find((product) => product.pending > 0) ?? visible.find((product) => product.deferred > 0);

  return <>
    <div className="review-overview">
      <div className="review-progress">
        <label htmlFor="review-progress">{completed} / {products.length} {t("review.products_reviewed")}</label>
        <progress id="review-progress" value={completed} max={products.length} />
      </div>
      {resume ? <Link className="review-button review-primary" href={reviewHref(selection, resume.id)} prefetch={false}>
        {t("review.continue")} <span aria-hidden="true">→</span>
      </Link> : null}
    </div>

    <div className="review-tools">
      <div className="review-queue-filters" role="group" aria-label={t("review.filter_status")}>
        {reviewFilters.map((status) => <button key={status} type="button" aria-pressed={filter === status}
          onClick={() => setFilter(status)}>{t(`review.filter.${status}`)}</button>)}
      </div>
      <div className="review-search">
        <label>
          {t("review.search")}
          <input type="search" placeholder={t("review.search_placeholder")} value={query} maxLength={120}
            onChange={(event) => setQuery(event.target.value)} />
        </label>
        {categories.length > 1 ? <label>
          {t("review.category")}
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">{t("review.all_categories")}</option>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label> : null}
      </div>
    </div>

    <p className="review-quiet review-count" role="status">{visible.length} {t("review.products_found")}</p>
    {visible.length ? <ul className="review-list">
      {visible.map((product) => <li key={product.id}>
        <Link href={reviewHref(selection, product.id)} prefetch={false}>
          <span className="review-list-name">
            <strong>{product.name ?? t("review.unnamed")}</strong>
            <small>#{product.wordpressId}{product.category ? ` · ${product.category}` : ""}
              {product.sourceStatus === "DRAFT" ? ` · ${t("review.DRAFT")}` : ""}</small>
          </span>
          <span className="review-list-status">
            {product.recommendedOrder !== null && product.pending > 0 ? <small className="review-status" data-state="recommended">
              {t("review.recommended")}
            </small> : null}
            {product.pending > 0 ? <small className="review-status" data-state="pending">
              {product.pending} {t("review.pending")}
            </small> : null}
            {product.deferred > 0 ? <small className="review-status" data-state="deferred">
              {product.deferred} {t("review.deferred")}
            </small> : null}
            {product.pending === 0 && product.deferred === 0 ? <small className="review-status" data-state="done">
              {t("review.done")}
            </small> : null}
          </span>
          <span className="review-list-arrow" aria-hidden="true">→</span>
        </Link>
      </li>)}
    </ul> : <p>{t("review.no_results")}</p>}
  </>;
}

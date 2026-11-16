import type { ReviewProductSummary } from "@khidi/catalog-review";

export const reviewFilters = ["all", "pending", "deferred", "done"] as const;
export type ReviewFilter = (typeof reviewFilters)[number];
export type ReviewQueueFilters = { q: string; category: string; status: ReviewFilter };

export function readReviewFilters(params: Record<string, string | string[] | undefined>): ReviewQueueFilters {
  return {
    q: typeof params.q === "string" ? params.q.slice(0, 120) : "",
    category: typeof params.category === "string" ? params.category.slice(0, 120) : "",
    status: reviewFilters.find((status) => status === params.status) ?? "all"
  };
}

export function reviewHref(filters: ReviewQueueFilters, productId?: string, view?: string) {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.status !== "all") params.set("status", filters.status);
  if (view) params.set("view", view);
  const query = params.toString();
  return `/review${productId ? `/${productId}` : ""}${query ? `?${query}` : ""}`;
}

export function matchesReviewScope(product: ReviewProductSummary, category: string, status: ReviewFilter) {
  return (!category || product.category === category) && (status === "all"
    || (status === "done" ? product.pending === 0 && product.deferred === 0 : product[status] > 0));
}

export function orderReviewQueue(products: ReviewProductSummary[]) {
  return [...products].sort((a, b) => Number(b.pending > 0) - Number(a.pending > 0)
    || (a.pending > 0 ? (a.recommendedOrder ?? Number.MAX_SAFE_INTEGER) - (b.recommendedOrder ?? Number.MAX_SAFE_INTEGER) : 0)
    || Number(b.deferred > 0) - Number(a.deferred > 0) || a.wordpressId - b.wordpressId);
}

export function nextReviewProduct(products: ReviewProductSummary[], currentId: string,
  { category = "", status = "all" }: Partial<ReviewQueueFilters> = {}) {
  const index = products.findIndex((product) => product.id === currentId);
  const eligible = (product: ReviewProductSummary) => matchesReviewScope(product, category, status === "all" ? "pending" : status);
  return products.slice(index + 1).find(eligible) ?? products.slice(0, Math.max(index, 0)).find(eligible);
}

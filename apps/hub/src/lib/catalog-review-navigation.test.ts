import { describe, expect, it } from "vitest";
import type { ReviewProductSummary } from "@khidi/catalog-review";
import { nextReviewProduct, orderReviewQueue, readReviewFilters, reviewHref } from "./catalog-review-navigation.ts";

function product(wordpressId: number, pending: number, deferred = 0): ReviewProductSummary {
  return { id: String(wordpressId), wordpressId, pending, deferred, total: 4, recommendedOrder: null,
    sourceStatus: "PUBLISHED", name: null, category: null };
}

describe("review queue navigation", () => {
  it("puts recommended pending items first without hiding the rest of the set", () => {
    const ordered = orderReviewQueue([product(1, 1), { ...product(9, 1), recommendedOrder: 2 },
      { ...product(8, 1), recommendedOrder: 1 }, { ...product(2, 0, 1), recommendedOrder: 3 }]);
    expect(ordered.map((item) => item.wordpressId)).toEqual([8, 9, 1, 2]);
  });
  it("prioritizes open issues and returns a stable order for a 300-product queue", () => {
    const products = Array.from({ length: 300 }, (_, index) =>
      product(300 - index, index % 3 === 0 ? 1 : 0, index % 3 === 1 ? 1 : 0));
    const ordered = orderReviewQueue(products);
    expect(ordered).toHaveLength(300);
    expect(ordered.slice(0, 100).every((item) => item.pending > 0)).toBe(true);
    expect(ordered.slice(100, 200).every((item) => item.deferred > 0)).toBe(true);
    expect(ordered.slice(200).every((item) => item.pending === 0 && item.deferred === 0)).toBe(true);
    expect(ordered[0]?.wordpressId).toBe(3);
    expect(products[0]?.wordpressId).toBe(300);
  });

  it("continues forward, wraps to earlier work and excludes the current product", () => {
    const products = [product(10, 1), product(11, 0, 2), product(12, 0), product(13, 3)];
    expect(nextReviewProduct(products, "10")?.id).toBe("13");
    expect(nextReviewProduct(products, "13")?.id).toBe("10");
    expect(nextReviewProduct(products.slice(0, 3), "10")).toBeUndefined();
  });

  it("keeps the category and status on the next product and encodes the return search", () => {
    const filters = readReviewFilters({ q: "#10 & ტექსტი", category: "ავტო", status: "deferred" });
    const products = [
      { ...product(10, 0, 1), category: "ავტო" },
      { ...product(11, 1), category: "ავტო" },
      { ...product(12, 0, 1), category: "სხვა" },
      { ...product(13, 0, 1), category: "ავტო" }
    ];
    expect(nextReviewProduct(products, "10", filters)?.id).toBe("13");
    const href = new URL(reviewHref(filters, "13", "photos"), "http://localhost");
    expect(href.pathname).toBe("/review/13");
    expect(Object.fromEntries(href.searchParams)).toEqual({ ...filters, view: "photos" });
  });
});

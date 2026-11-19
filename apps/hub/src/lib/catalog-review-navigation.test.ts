import { describe, expect, it } from "vitest";
import type { ReviewProductSummary } from "@khidi/catalog-review";
import { matchesReviewScope, nextReviewProduct, orderReviewQueue, readReviewFilters, reviewHref } from "./catalog-review-navigation.ts";

function product(wordpressId: number, pending: number, deferred = 0): ReviewProductSummary {
  return { id: String(wordpressId), wordpressId, pending, deferred, total: 4, recommendedOrder: null,
    sourceStatus: "PUBLISHED", name: null, category: null };
}

describe("review queue navigation", () => {
  it("distinguishes photo uploads from detail requests for the next pass", () => {
    const row = { ...product(1, 0), uploads: 1, detailRequests: 0 };
    expect(matchesReviewScope(row, { status: "uploads", q: "#1" })).toBe(true);
    expect(matchesReviewScope(row, { status: "uploads", q: "#2" })).toBe(false);
    expect(matchesReviewScope(row, { status: "detailRequests" })).toBe(false);
    expect(readReviewFilters({ status: "detailRequests" }).status).toBe("detailRequests");
  });
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
    expect(nextReviewProduct(products, "10", { ...filters, q: "" })?.id).toBe("13");
    const href = new URL(reviewHref(filters, "13", "photos"), "http://localhost");
    expect(href.pathname).toBe("/review/13");
    expect(Object.fromEntries(href.searchParams)).toEqual({ ...filters, view: "photos" });
  });

  it("keeps next and wrapped navigation inside the same text search as the queue", () => {
    const products = [
      { ...product(8135, 1), name: "გენერატორი FT51975" },
      { ...product(8138, 1), name: "FT51975 გენერატორი" },
      { ...product(8169, 1), name: "აბრაზიული დისკი" }
    ];
    const filters = { q: " ft51975 ", category: "", status: "all" } as const;
    expect(products.filter((item) => matchesReviewScope(item, filters)).map((item) => item.id)).toEqual(["8135", "8138"]);
    expect(nextReviewProduct(products, "8135", filters)?.id).toBe("8138");
    expect(nextReviewProduct(products, "8138", filters)?.id).toBe("8135");
    expect(nextReviewProduct(products, "8138", { ...filters, q: "#8138" })).toBeUndefined();
    expect(nextReviewProduct(products, "8138", { ...filters, q: "არ არსებობს" })).toBeUndefined();
  });

  it("combines search, category and deferred status without escaping any filter", () => {
    const products = [
      { ...product(1, 0, 1), name: "ტუმბო", category: "წყალი" },
      { ...product(2, 1), name: "ტუმბო", category: "წყალი" },
      { ...product(3, 0, 1), name: "ტუმბო", category: "სხვა" },
      { ...product(4, 0, 1), name: "მილი", category: "წყალი" },
      { ...product(5, 0, 1), name: "ტუმბო", category: "წყალი" }
    ];
    expect(nextReviewProduct(products, "1", { q: "ტუმბო", category: "წყალი", status: "deferred" })?.id).toBe("5");
    expect(matchesReviewScope(product(7161, 1), { q: "უსახელო" })).toBe(true);
  });
});

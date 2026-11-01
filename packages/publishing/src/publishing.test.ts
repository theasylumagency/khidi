import { describe, expect, it } from "vitest";
import { evaluateStorefrontSellability } from "./index.ts";

describe("@khidi/publishing — Sellability Evaluator [C5, C8, C9, C18]", () => {
  it("returns sellable=true only when all §15.2 + C8 + C9 conditions hold", () => {
    const res = evaluateStorefrontSellability({
      lifecycleState: "READY",
      canonicalSlug: "hiromiki-d178e-df900q",
      hasActiveSellerAccountingMapping: true,
      requiresOwnerAccountingMapping: true,
      hasActiveOwnerAccountingMapping: true,
      hasCurrentBasePrice: true,
      hasVerifiedPublicMainImage: true,
      isStorefrontListingEnabled: true
    });

    expect(res.sellable).toBe(true);
    expect(res.blockingReasons).toEqual([]);
  });

  it("blocks sellability when canonicalSlug is null [C8] or owner mapping is missing in CONSIGNMENT [C9]", () => {
    const res = evaluateStorefrontSellability({
      lifecycleState: "READY",
      canonicalSlug: null,
      hasActiveSellerAccountingMapping: true,
      requiresOwnerAccountingMapping: true,
      hasActiveOwnerAccountingMapping: false,
      hasCurrentBasePrice: false,
      hasVerifiedPublicMainImage: true,
      isStorefrontListingEnabled: false
    });

    expect(res.sellable).toBe(false);
    expect(res.blockingReasons).toEqual([
      "MISSING_CANONICAL_SLUG",
      "MISSING_OWNER_ACCOUNTING_MAPPING",
      "MISSING_STOREFRONT_BASE_PRICE",
      "STOREFRONT_LISTING_DISABLED"
    ]);
  });
});

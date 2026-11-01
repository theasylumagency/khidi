import type { SkuLifecycleState } from "@agrotrade/products";

/**
 * [C5, C8, C9, C18] Storefront Sellability Evaluator contract (§15.2).
 * Lives in @agrotrade/publishing above catalog and commerce layers to avoid dependency cycles.
 * Checked only at RESERVE ([C18]).
 */
export interface SellabilityEvaluationInput {
  lifecycleState: SkuLifecycleState;
  canonicalSlug: string | null; // [C8] Must be non-null
  hasActiveSellerAccountingMapping: boolean; // [C9]
  requiresOwnerAccountingMapping: boolean; // True when owner entity != seller entity (CONSIGNMENT)
  hasActiveOwnerAccountingMapping: boolean; // [C9]
  hasCurrentBasePrice: boolean;
  hasVerifiedPublicMainImage: boolean;
  isStorefrontListingEnabled: boolean; // §4.5
}

export interface SellabilityEvaluationResult {
  sellable: boolean;
  blockingReasons: string[];
}

export function evaluateStorefrontSellability(
  input: SellabilityEvaluationInput
): SellabilityEvaluationResult {
  const blockingReasons: string[] = [];

  if (input.lifecycleState !== "READY") {
    blockingReasons.push("SKU_NOT_READY");
  }
  if (!input.canonicalSlug) {
    blockingReasons.push("MISSING_CANONICAL_SLUG");
  }
  if (!input.hasActiveSellerAccountingMapping) {
    blockingReasons.push("MISSING_SELLER_ACCOUNTING_MAPPING");
  }
  if (input.requiresOwnerAccountingMapping && !input.hasActiveOwnerAccountingMapping) {
    blockingReasons.push("MISSING_OWNER_ACCOUNTING_MAPPING");
  }
  if (!input.hasCurrentBasePrice) {
    blockingReasons.push("MISSING_STOREFRONT_BASE_PRICE");
  }
  if (!input.hasVerifiedPublicMainImage) {
    blockingReasons.push("MISSING_VERIFIED_PUBLIC_MAIN_IMAGE");
  }
  if (!input.isStorefrontListingEnabled) {
    blockingReasons.push("STOREFRONT_LISTING_DISABLED");
  }

  return {
    sellable: blockingReasons.length === 0,
    blockingReasons
  };
}

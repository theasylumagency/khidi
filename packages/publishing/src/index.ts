import { getSkuWithDetails, isPublicCanonicalField, isPublicCanonicalText, type SkuLifecycleState } from "@khidi/products";
import { listStorefronts } from "@khidi/entities";
import { hasVerifiedPublicMainImage, listStorefrontMedia } from "@khidi/media";
import { compareApprovedContentFacts, getApprovedContent, getContentFactFields, getStorefrontIdentityFacts } from "@khidi/evidence";
import { AppError } from "@khidi/shared";

/**
 * [C5, C8, C9, C18] Storefront Sellability Evaluator contract (§15.2).
 * Lives in @khidi/publishing above catalog and commerce layers to avoid dependency cycles.
 * Checked only at RESERVE ([C18]).
 */
export interface SellabilityEvaluationInput {
  lifecycleState: SkuLifecycleState;
  canonicalSlug: string | null; // [C8] Must be non-null
  hasActiveSellerAccountingMapping: boolean; // [C9]
  requiresOwnerAccountingMapping: boolean | undefined; // undefined until allocation data is available
  hasActiveOwnerAccountingMapping: boolean; // [C9]
  hasCurrentBasePrice: boolean | undefined; // undefined until pricing data is available
  hasVerifiedPublicMainImage: boolean;
  isStorefrontListingEnabled: boolean; // §4.5
  identityConflict?: boolean;
  hasApprovedLocaleContent: boolean;
  hasReferencedContentConflict?: boolean;
}

export interface SellabilityEvaluationResult {
  sellable: boolean;
  blockingReasons: string[];
  publishReady: boolean;
  publicationBlockers: string[];
}

export function evaluateStorefrontSellability(
  input: SellabilityEvaluationInput
): SellabilityEvaluationResult {
  const blockingReasons: string[] = [];
  const publicationBlockers: string[] = [];
  const blockPublication = (reason: string) => {
    publicationBlockers.push(reason);
    blockingReasons.push(reason);
  };

  if (input.lifecycleState !== "READY") {
    blockPublication("SKU_NOT_READY");
  }
  if (input.identityConflict) blockPublication("IDENTITY_CONFLICT");
  if (!input.canonicalSlug) {
    blockPublication("MISSING_CANONICAL_SLUG");
  }
  if (!input.hasActiveSellerAccountingMapping) {
    blockingReasons.push("MISSING_SELLER_ACCOUNTING_MAPPING");
  }
  if (input.requiresOwnerAccountingMapping === undefined) {
    blockingReasons.push("ALLOCATION_OWNERS_UNAVAILABLE_M8");
  } else if (input.requiresOwnerAccountingMapping && !input.hasActiveOwnerAccountingMapping) {
    blockingReasons.push("MISSING_OWNER_ACCOUNTING_MAPPING");
  }
  if (input.hasCurrentBasePrice === undefined) {
    blockingReasons.push("STOREFRONT_PRICING_UNAVAILABLE_M7");
  } else if (!input.hasCurrentBasePrice) {
    blockingReasons.push("MISSING_STOREFRONT_BASE_PRICE");
  }
  if (!input.hasVerifiedPublicMainImage) {
    blockPublication("MISSING_VERIFIED_PUBLIC_MAIN_IMAGE");
  }
  if (!input.isStorefrontListingEnabled) {
    blockPublication("STOREFRONT_LISTING_DISABLED");
  }
  if (!input.hasApprovedLocaleContent) blockPublication("MISSING_APPROVED_LOCALE_CONTENT");
  if (input.hasReferencedContentConflict) blockPublication("LOCALE_CONTENT_FACT_CONFLICT");

  return {
    sellable: blockingReasons.length === 0,
    blockingReasons, publishReady: publicationBlockers.length === 0, publicationBlockers
  };
}
/** Server-side media fact: callers cannot substitute a client-supplied image flag. */
export async function evaluateSkuMediaSellability(db: Parameters<typeof hasVerifiedPublicMainImage>[0], skuId: string, input: Omit<SellabilityEvaluationInput, "hasVerifiedPublicMainImage">) {
  const [identity, hasVerifiedPublicMainImageForSku] = await Promise.all([
    getStorefrontIdentityFacts(db, skuId), hasVerifiedPublicMainImage(db, skuId)
  ]);
  return evaluateStorefrontSellability({ ...input, identityConflict: identity.identityConflict, hasVerifiedPublicMainImage: hasVerifiedPublicMainImageForSku });
}

export { getStorefrontIdentityFacts };

type PublishingDb = Parameters<typeof hasVerifiedPublicMainImage>[0];
export interface StorefrontCommerceFacts {
  /** Omitted when allocations are unavailable. An empty list is a known absence of allocations. */
  allocatedOwnerEntityIds?: readonly string[];
  hasCurrentBasePrice?: boolean;
}

async function loadPublicationInputs(db: PublishingDb, skuId: string, catalog?: {
  details: Awaited<ReturnType<typeof getSkuWithDetails>>; stores: Awaited<ReturnType<typeof listStorefronts>>;
}) {
  const [details, stores, approvals, fields, hasVerifiedPublicMainImageForSku] = await Promise.all([
    catalog?.details ?? getSkuWithDetails(db, skuId), catalog?.stores ?? listStorefronts(db),
    getApprovedContent(db, skuId), getContentFactFields(db, skuId),
    hasVerifiedPublicMainImage(db, skuId)
  ]);
  return { details, stores, approvals, fields, hasVerifiedPublicMainImageForSku };
}

function evaluateLocale(input: Awaited<ReturnType<typeof loadPublicationInputs>>,
  store: Awaited<ReturnType<typeof listStorefronts>>[number], locale: string, commerce: StorefrontCommerceFacts = {}) {
  const { details, approvals, fields, hasVerifiedPublicMainImageForSku } = input;
  const version = approvals.find(({ version }) => version.locale === locale)?.version;
  const conflicts = version ? compareApprovedContentFacts(version.verifiedFacts, fields).conflictingFields : [];
  const owners = commerce.allocatedOwnerEntityIds?.filter((id) => id !== store.sellerEntityId);
  const mappings = new Set(details.accountingMappings.filter((mapping) => mapping.active).map((mapping) => mapping.legalEntityId));
  const slug = details.sku.canonicalSlug;
  const result = evaluateStorefrontSellability({
    lifecycleState: details.sku.lifecycleState as SkuLifecycleState,
    identityConflict: details.sku.identityConfidence === "CONFLICT",
    canonicalSlug: slug && isPublicCanonicalText(slug) && !/khidi-(app|internal)/i.test(slug) ? slug : null,
    hasActiveSellerAccountingMapping: mappings.has(store.sellerEntityId),
    requiresOwnerAccountingMapping: owners ? owners.length > 0 : undefined,
    hasActiveOwnerAccountingMapping: !!owners && owners.every((id) => mappings.has(id)),
    hasCurrentBasePrice: commerce.hasCurrentBasePrice,
    hasVerifiedPublicMainImage: hasVerifiedPublicMainImageForSku,
    isStorefrontListingEnabled: store.active && details.storefrontListings.some((listing) => listing.storefrontId === store.id && listing.enabled),
    hasApprovedLocaleContent: !!version,
    hasReferencedContentConflict: conflicts.length > 0
  });
  return { result, version };
}

export async function getSkuPublicationReview(db: PublishingDb, skuId: string, catalog?: Parameters<typeof loadPublicationInputs>[2]) {
  const input = await loadPublicationInputs(db, skuId, catalog);
  const locales = [...new Set(["ka", "en", ...input.approvals.map(({ version }) => version.locale)])];
  return input.stores.flatMap((store) => locales.map((locale) => ({
    storefrontId: store.id, storefrontName: store.name, locale, ...evaluateLocale(input, store, locale).result
  })));
}

export async function getStorefrontProductProjection(db: PublishingDb, target: {
  skuId: string; storefrontId: string; locale: string; commerce?: StorefrontCommerceFacts;
}) {
  const input = await loadPublicationInputs(db, target.skuId);
  const store = input.stores.find((store) => store.id === target.storefrontId);
  if (!store) throw new AppError("NOT_FOUND", "Storefront not found.");
  const { result, version } = evaluateLocale(input, store, target.locale, target.commerce);
  if (!result.publishReady || !version) return null;
  const fields = Object.fromEntries([...input.fields].flatMap(([key, field]) =>
    field.status === "VERIFIED" && field.value !== null && !field.notDeterminableReason && isPublicCanonicalField(key)
      && (typeof field.value !== "string" || isPublicCanonicalText(field.value)) ? [[key, field.value]] : []));
  const media = await listStorefrontMedia(db, target.skuId, target.storefrontId);
  return {
    slug: input.details.sku.canonicalSlug!, locale: version.locale, displayName: version.displayName,
    shortDescription: version.shortDescription, fullDescription: version.fullDescription,
    fields, media, sellable: result.sellable, blockingReasons: result.blockingReasons
  };
}

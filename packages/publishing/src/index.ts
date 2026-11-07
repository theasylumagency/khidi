import { findConfidentialPhrase, getCanonicalConfidentialTerms, getSkuWithDetails, isPublicCanonicalField, isPublicCanonicalText, type SkuLifecycleState } from "@khidi/products";
import { listStorefronts } from "@khidi/entities";
import { hasVerifiedPublicMainImage, listStorefrontMedia } from "@khidi/media";
import { compareApprovedContentFacts, getApprovedContent, getContentFactFields, getStorefrontIdentityFacts } from "@khidi/evidence";
import { AppError } from "@khidi/shared";
import { listLatestPrices } from "@khidi/pricing";
import { getSkuAllocationFacts } from "@khidi/inventory";

/**
 * [C5, C8, C9, C18] Storefront Sellability Evaluator contract (§15.2).
 * Lives in @khidi/publishing above catalog and commerce layers to avoid dependency cycles.
 * Checked only at RESERVE ([C18]).
 */
export interface SellabilityEvaluationInput {
  lifecycleState: SkuLifecycleState;
  canonicalSlug: string | null; // [C8] Must be non-null
  hasActiveSellerAccountingMapping: boolean; // [C9]
  hasStorefrontAllocation: boolean;
  requiresOwnerAccountingMapping: boolean;
  hasActiveOwnerAccountingMapping: boolean; // [C9]
  hasCurrentBasePrice: boolean;
  hasVerifiedPublicMainImage: boolean;
  isStorefrontListingEnabled: boolean; // §4.5
  identityConflict?: boolean;
  hasApprovedLocaleContent: boolean;
  hasReferencedContentChange?: boolean;
  hasReferencedContentConflict?: boolean;
  hasConfidentialLocaleContent?: boolean;
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
  if (!input.hasStorefrontAllocation) blockingReasons.push("MISSING_STOREFRONT_ALLOCATION");
  if (input.requiresOwnerAccountingMapping && !input.hasActiveOwnerAccountingMapping) {
    blockingReasons.push("MISSING_OWNER_ACCOUNTING_MAPPING");
  }
  if (!input.hasCurrentBasePrice) {
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
  else if (input.hasReferencedContentChange) blockPublication("LOCALE_CONTENT_FACT_CHANGED");
  if (input.hasConfidentialLocaleContent) blockPublication("LOCALE_CONTENT_CONFIDENTIAL");

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

async function loadPublicationInputs(db: PublishingDb, skuId: string, catalog?: {
  details: Awaited<ReturnType<typeof getSkuWithDetails>>; stores: Awaited<ReturnType<typeof listStorefronts>>;
}) {
  const [details, stores, approvals, fields, hasVerifiedPublicMainImageForSku, confidentialTerms, prices, allocationFacts] = await Promise.all([
    catalog?.details ?? getSkuWithDetails(db, skuId), catalog?.stores ?? listStorefronts(db),
    getApprovedContent(db, skuId), getContentFactFields(db, skuId),
    hasVerifiedPublicMainImage(db, skuId), getCanonicalConfidentialTerms(db), listLatestPrices(db, { skuId }), getSkuAllocationFacts(db,skuId)
  ]);
  return { details, stores, approvals, fields, hasVerifiedPublicMainImageForSku, confidentialTerms, prices, allocationFacts };
}

function evaluateLocale(input: Awaited<ReturnType<typeof loadPublicationInputs>>,
  store: Awaited<ReturnType<typeof listStorefronts>>[number], locale: string) {
  const { details, approvals, fields, hasVerifiedPublicMainImageForSku } = input;
  const version = approvals.find(({ version }) => version.locale === locale)?.version;
  const factComparison = version && compareApprovedContentFacts(version.verifiedFacts, fields);
  const allocationFacts=input.allocationFacts.filter((a)=>a.storefrontId===store.id);
  const owners=[...new Set(allocationFacts.map((a)=>a.ownerEntityId))].filter((id)=>id!==store.sellerEntityId);
  const mappings = new Set(details.accountingMappings.filter((mapping) => mapping.active).map((mapping) => mapping.legalEntityId));
  const slug = details.sku.canonicalSlug;
  const result = evaluateStorefrontSellability({
    lifecycleState: details.sku.lifecycleState as SkuLifecycleState,
    identityConflict: details.sku.identityConfidence === "CONFLICT",
    canonicalSlug: slug && isPublicCanonicalText(slug) && !/khidi-(app|internal)/i.test(slug) ? slug : null,
    hasActiveSellerAccountingMapping: mappings.has(store.sellerEntityId),
    hasStorefrontAllocation: allocationFacts.length>0,
    requiresOwnerAccountingMapping: owners.length>0,
    hasActiveOwnerAccountingMapping: owners.every((id) => mappings.has(id)),
    hasCurrentBasePrice: input.prices.some((row) => row.storefrontId === store.id && row.kind === "SET"),
    hasVerifiedPublicMainImage: hasVerifiedPublicMainImageForSku,
    isStorefrontListingEnabled: store.active && details.storefrontListings.some((listing) => listing.storefrontId === store.id && listing.enabled),
    hasApprovedLocaleContent: !!version,
    hasReferencedContentChange: !!factComparison?.changedFields.length,
    hasReferencedContentConflict: !!factComparison?.conflictingFields.length,
    hasConfidentialLocaleContent: !!version && [version.displayName, version.shortDescription, version.fullDescription]
      .some((text) => findConfidentialPhrase(text, input.confidentialTerms) !== null)
  });
  return { result, version, availableToSell:allocationFacts.reduce((sum,a)=>sum+a.availableToSell,0) };
}

export async function getSkuPublicationReview(db: PublishingDb, skuId: string, catalog?: Parameters<typeof loadPublicationInputs>[2]) {
  const input = await loadPublicationInputs(db, skuId, catalog);
  const locales = [...new Set(["ka", "en", ...input.approvals.map(({ version }) => version.locale)])];
  return input.stores.flatMap((store) => locales.map((locale) => {
    const evaluation=evaluateLocale(input,store,locale);
    return {storefrontId:store.id,storefrontName:store.name,locale,...evaluation.result,availableToSell:evaluation.availableToSell};
  }));
}

export async function getStorefrontProductProjection(db: PublishingDb, target: {
  skuId: string; storefrontId: string; locale: string;
}) {
  const input = await loadPublicationInputs(db, target.skuId);
  const store = input.stores.find((store) => store.id === target.storefrontId);
  if (!store) throw new AppError("NOT_FOUND", "Storefront not found.");
  const { result, version, availableToSell } = evaluateLocale(input, store, target.locale);
  if (!result.publishReady || !version) return null;
  const fields = Object.fromEntries([...input.fields].flatMap(([key, field]) =>
    field.status === "VERIFIED" && field.value !== null && !field.notDeterminableReason && isPublicCanonicalField(key)
      && (typeof field.value !== "string" || (isPublicCanonicalText(field.value) && !findConfidentialPhrase(field.value, input.confidentialTerms)))
      ? [[key, field.value]] : []));
  const media = await listStorefrontMedia(db, target.skuId, target.storefrontId);
  const price = input.prices.find((row) => row.storefrontId === store.id && row.kind === "SET");
  return {
    slug: input.details.sku.canonicalSlug!, locale: version.locale, displayName: version.displayName,
    shortDescription: version.shortDescription, fullDescription: version.fullDescription,
    fields, media, ...(price ? { basePrice: { amount: price.basePriceMinor!, currency: price.currency, vat_included: price.vatIncluded } } : {}),
    sellable: result.sellable, blockingReasons: result.blockingReasons, available_to_sell:availableToSell
  };
}

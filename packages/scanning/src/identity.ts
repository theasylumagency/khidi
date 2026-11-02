import type { DbExecutor } from "@khidi/db";
import type { DomainActor } from "@khidi/domain";
import { attachSkuIdentifier, buildCandidateLookupValues, createSkuDraft, normalizeIdentifierOnWrite, resolveSkuByScannedIdentifier, type SkuIdentifierType } from "@khidi/products";
import type { IntakeResult, ReviewReason } from "./contracts.ts";

export function normalizeScan(value: string, identifierType?: SkuIdentifierType) {
  const internal = /^(?:khidi:\/\/sku\/)?(KH-\d{6,})$/i.exec(value.trim());
  if (internal) {
    const canonicalValue = internal[1]!.toUpperCase();
    return { canonicalValue, canonicalType: "INTERNAL_SKU" as SkuIdentifierType, key: `INTERNAL:${canonicalValue}`, internal: true };
  }
  let inferred: SkuIdentifierType = "SUPPLIER_CODE";
  if (buildCandidateLookupValues(value).some((candidate) => /^\d{14}$/.test(candidate))) {
    try { normalizeIdentifierOnWrite("GTIN", value); inferred = "GTIN"; } catch { /* a numeric supplier code */ }
  }
  const normalized = normalizeIdentifierOnWrite(identifierType ?? inferred, value);
  return { ...normalized, canonicalType: normalized.canonicalType as SkuIdentifierType,
    key: `${normalized.canonicalType === "GTIN" ? "GTIN" : "VALUE"}:${normalized.canonicalValue}`, internal: false };
}
export type NormalizedScan = ReturnType<typeof normalizeScan>;
export interface ScanIdentity {
  skuId: string | null; resultState: IntakeResult["resultState"];
  reviewReason: ReviewReason | null; referenceSkuId: string | null;
}

/** Read-only unless explicitly allowed by a clean intake or an admin resolution. */
export async function resolveScanIdentity(tx: DbExecutor, actor: DomainActor, normalized: NormalizedScan | null,
  options: { allowCreate: boolean; productTypeId?: string | null }): Promise<ScanIdentity> {
  const lookup = normalized ? await resolveSkuByScannedIdentifier(tx, normalized.canonicalValue) : null;
  if (lookup?.isAmbiguousCollision) return { skuId: null, resultState: "MANUAL_IDENTIFICATION_REQUIRED", reviewReason: "IDENTIFIER_COLLISION", referenceSkuId: null };
  if (lookup?.uniqueSkuIds.length === 1) return { skuId: lookup.uniqueSkuIds[0]!, resultState: "MATCHED_EXISTING", reviewReason: null, referenceSkuId: null };
  if (normalized?.internal) {
    const archived = await resolveSkuByScannedIdentifier(tx, normalized.canonicalValue, { includeArchived: true });
    return { skuId: null, resultState: "MANUAL_IDENTIFICATION_REQUIRED",
      reviewReason: archived.uniqueSkuIds.length ? "ARCHIVED_INTERNAL_LABEL" : "UNKNOWN_INTERNAL_LABEL",
      referenceSkuId: archived.uniqueSkuIds[0] ?? null };
  }
  if (!options.allowCreate) return { skuId: null, resultState: "MANUAL_IDENTIFICATION_REQUIRED", reviewReason: null, referenceSkuId: null };
  const draft = await createSkuDraft(tx, actor, { productTypeId: options.productTypeId });
  if (normalized) await attachSkuIdentifier(tx, actor, { skuId: draft.id, identifierType: normalized.canonicalType,
    value: normalized.canonicalValue, verified: false, issuerSource: "WAREHOUSE_SCAN" });
  return { skuId: draft.id, resultState: "NEW_DRAFT", reviewReason: null, referenceSkuId: null };
}

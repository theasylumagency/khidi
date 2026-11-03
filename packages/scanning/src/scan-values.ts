import { buildCandidateLookupValues, normalizeIdentifierOnWrite } from "@khidi/products/identifiers";
import type { SkuIdentifierType } from "@khidi/products";

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

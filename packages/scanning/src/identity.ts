import type { DbExecutor } from "@khidi/db";
import type { DomainActor } from "@khidi/domain";
import { attachSkuIdentifier, createSkuDraft, resolveSkuByScannedIdentifier } from "@khidi/products";
import type { IntakeResult, ReviewReason } from "./contracts.ts";

import { normalizeScan, type NormalizedScan } from "./scan-values.ts";
export { normalizeScan, type NormalizedScan } from "./scan-values.ts";
export interface ScanIdentity {
  skuId: string | null; resultState: IntakeResult["resultState"];
  reviewReason: ReviewReason | null; referenceSkuId: string | null;
  scannedSkuId?: string;
}

/** Read-only unless explicitly allowed by a clean intake or an admin resolution. */
export async function resolveScanIdentity(tx: DbExecutor, actor: DomainActor, normalized: NormalizedScan | null,
  options: { allowCreate: boolean; productTypeId?: string | null }): Promise<ScanIdentity> {
  const lookup = normalized ? await resolveSkuByScannedIdentifier(tx, normalized.canonicalValue) : null;
  if (lookup?.isAmbiguousCollision) return { skuId: null, resultState: "MANUAL_IDENTIFICATION_REQUIRED", reviewReason: "IDENTIFIER_COLLISION", referenceSkuId: null };
  if (lookup?.uniqueSkuIds.length === 1) return { skuId: lookup.uniqueSkuIds[0]!, resultState: "MATCHED_EXISTING", reviewReason: null,
    referenceSkuId: null, scannedSkuId: normalized?.internal ? lookup.matches[0]?.scannedSkuId : undefined };
  if (normalized?.internal) {
    const archived = await resolveSkuByScannedIdentifier(tx, normalized.canonicalValue, { includeArchived: true });
    return { skuId: null, resultState: "MANUAL_IDENTIFICATION_REQUIRED",
      reviewReason: archived.uniqueSkuIds.length ? "ARCHIVED_INTERNAL_LABEL" : "UNKNOWN_INTERNAL_LABEL",
      referenceSkuId: archived.uniqueSkuIds[0] ?? null, scannedSkuId: archived.uniqueSkuIds[0] };
  }
  if (!options.allowCreate) return { skuId: null, resultState: "MANUAL_IDENTIFICATION_REQUIRED", reviewReason: null, referenceSkuId: null };
  const draft = await createSkuDraft(tx, actor, { productTypeId: options.productTypeId });
  if (normalized) await attachSkuIdentifier(tx, actor, { skuId: draft.id, identifierType: normalized.canonicalType,
    value: normalized.canonicalValue, verified: false, issuerSource: "WAREHOUSE_SCAN" });
  return { skuId: draft.id, resultState: "NEW_DRAFT", reviewReason: null, referenceSkuId: null };
}

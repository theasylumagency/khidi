import type { EvidenceValue } from "@khidi/db";

export const EVIDENCE_TYPES = [
  "PRODUCT_PLATE_PHOTO", "PRODUCT_MARKING_PHOTO", "PASSPORT_MANUAL", "FACTORY_SPEC_SHEET",
  "SUPPLIER_DOCUMENT", "MEASUREMENT", "ADMIN_PHYSICAL_INSPECTION", "PACKAGING_PHOTO",
  "CUSTOMS_DECLARATION", "SUPPLIER_CORRESPONDENCE", "SUPPLIER_CATALOG", "STAFF_STATEMENT", "PUBLIC_WEB"
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export const IDENTITY_KINDS = ["HOUSE_DEFINED", "MANUFACTURER_IDENTIFIED"] as const;
export type IdentityKind = (typeof IDENTITY_KINDS)[number];
export const IDENTITY_RULE_VERSION = "identity-rule-v1";

const internalTypes = new Set([
  "SUPPLIER_DOCUMENT", "ADMIN_PHYSICAL_INSPECTION", "CUSTOMS_DECLARATION",
  "SUPPLIER_CORRESPONDENCE", "SUPPLIER_CATALOG", "STAFF_STATEMENT"
]);
const strongTypes = new Set([
  "PRODUCT_PLATE_PHOTO", "PRODUCT_MARKING_PHOTO", "PASSPORT_MANUAL",
  "FACTORY_SPEC_SHEET", "SUPPLIER_DOCUMENT", "ADMIN_PHYSICAL_INSPECTION"
]);
const anchorTypes = new Set([
  "SUPPLIER_DOCUMENT", "CUSTOMS_DECLARATION", "SUPPLIER_CORRESPONDENCE",
  "SUPPLIER_CATALOG", "FACTORY_SPEC_SHEET", "PASSPORT_MANUAL"
]);

export function allowsEvidencePdf(type: string) {
  return anchorTypes.has(type);
}

export interface EvidenceFactSource {
  id: string;
  type: string;
  status: string;
  imageId: string | null;
  claims: Record<string, EvidenceValue>;
}

export function evidenceSensitivity(type: EvidenceType, hasReadingPhoto: boolean, hasPrivateDocument = false) {
  return internalTypes.has(type) || (type === "MEASUREMENT" && !hasReadingPhoto) || hasPrivateDocument
    ? "INTERNAL_ONLY" as const : "AI_ALLOWED" as const;
}

export function evidenceStrength(item: Pick<EvidenceFactSource, "type" | "imageId">) {
  if (strongTypes.has(item.type) || (item.type === "MEASUREMENT" && item.imageId)) return "STRONG";
  if (item.type === "PUBLIC_WEB" || item.type === "STAFF_STATEMENT") return "WEAK";
  return "MEDIUM";
}

export function isDocumentAnchor(item: Pick<EvidenceFactSource, "type" | "status">) {
  return item.status === "ACCEPTED" && anchorTypes.has(item.type);
}

export interface FieldDecision {
  confirmedEvidenceId?: string | null;
  notDeterminableReason?: string | null;
}
export interface ResolvedField {
  status: "VERIFIED" | "UNVERIFIED" | "CONFLICT" | "NOT_FOUND";
  value: EvidenceValue | null;
  evidenceIds: string[];
  strong: boolean;
}

function comparable(value: EvidenceValue) {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase() : value;
}

export function evidenceValuesDiffer(left: EvidenceValue, right: EvidenceValue) {
  return comparable(left) !== comparable(right);
}

export function resolveEvidenceField(field: string, items: readonly EvidenceFactSource[], decision?: FieldDecision): ResolvedField {
  const candidates = items.filter((item) => item.status !== "REJECTED" && Object.hasOwn(item.claims, field))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!candidates.length) return { status: "NOT_FOUND", value: null, evidenceIds: [], strong: false };
  const evidenceIds = [...new Set(candidates.map((item) => item.id))].sort();
  if (new Set(candidates.map((item) => comparable(item.claims[field]!))).size > 1) {
    return { status: "CONFLICT", value: null, evidenceIds, strong: false };
  }
  const accepted = candidates.filter((item) => item.status === "ACCEPTED");
  const strong = accepted.filter((item) => evidenceStrength(item) === "STRONG");
  const medium = accepted.filter((item) => evidenceStrength(item) === "MEDIUM");
  const verified = strong.length > 0 || new Set(medium.map((item) => item.type)).size >= 2
    || medium.some((item) => item.id === decision?.confirmedEvidenceId);
  const chosen = strong[0] ?? medium[0] ?? accepted[0] ?? candidates[0]!;
  return {
    status: verified ? "VERIFIED" : "UNVERIFIED",
    value: chosen.claims[field]!,
    evidenceIds: verified ? [...new Set([...strong, ...medium].map((item) => item.id))].sort() : evidenceIds,
    strong: strong.length > 0
  };
}

type ComparisonField = { status: string; value: EvidenceValue | null };
export function hasVerifiedDifference(
  left: ReadonlyMap<string, ComparisonField>,
  right: ReadonlyMap<string, ComparisonField>
) {
  for (const [field, a] of left) {
    const b = right.get(field);
    if (a.status === "VERIFIED" && b?.status === "VERIFIED" && a.value !== null && b.value !== null
      && evidenceValuesDiffer(a.value, b.value)) return true;
  }
  return false;
}

export function computeIdentity(input: {
  kind: IdentityKind;
  productTypeSet: boolean;
  referencePhotos: boolean;
  unique: boolean;
  fields: ReadonlyMap<string, ResolvedField>;
  decisions: ReadonlyMap<string, FieldDecision>;
  distinguishingAttributes: readonly string[];
  items: readonly EvidenceFactSource[];
}) {
  const identityFields = input.kind === "MANUFACTURER_IDENTIFIED" ? ["brand", "model_code"]
    : ["product_type", ...input.distinguishingAttributes];
  const fields = identityFields.map((field) => input.fields.get(field));
  const confidence = (level: "HIGH" | "MEDIUM" | "LOW" | "CONFLICT", ids: string[] = []) => ({
    level, ruleVersion: IDENTITY_RULE_VERSION, evidenceIds: [...new Set(ids)].sort()
  });
  const evidenceIds = fields.flatMap((field) => field?.evidenceIds ?? []);
  if (fields.some((field) => field?.status === "CONFLICT")) return confidence("CONFLICT", evidenceIds);
  if (!input.unique) return confidence("LOW", evidenceIds);
  if (input.kind === "MANUFACTURER_IDENTIFIED") {
    if (fields.some((field) => field?.status !== "VERIFIED")) return confidence("LOW", evidenceIds);
    return confidence(fields.some((field) => field?.strong) ? "HIGH" : "MEDIUM", evidenceIds);
  }
  if (!input.productTypeSet || !input.referencePhotos
    || !input.distinguishingAttributes.every((key) => input.fields.get(key)?.status === "VERIFIED"
      || input.decisions.get(key)?.notDeterminableReason)) return confidence("LOW", evidenceIds);
  const verifiedEvidenceIds = fields.flatMap((field) => field?.status === "VERIFIED" ? field.evidenceIds : []);
  const anchors = input.items.filter(isDocumentAnchor);
  if (anchors.length) return confidence("HIGH", [...verifiedEvidenceIds, ...anchors.map((item) => item.id)]);
  const inspections = input.items.filter((item) => item.status === "ACCEPTED" && item.type === "ADMIN_PHYSICAL_INSPECTION");
  return inspections.length ? confidence("MEDIUM", [...verifiedEvidenceIds, ...inspections.map((item) => item.id)])
    : confidence("LOW", evidenceIds);
}

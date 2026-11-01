export const EVIDENCE_TYPES = [
  "PHOTO",
  "SPEC_SHEET",
  "IMPORTER_DOC",
  "PACKING_LIST",
  "INVOICE",
  "MANUAL",
  "PACKAGING",
  "DISTRIBUTOR",
  "PUBLIC_URL"
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

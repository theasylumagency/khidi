import { describe, expect, it } from "vitest";
import { computeIdentity, evidenceSensitivity, hasVerifiedDifference, resolveEvidenceField, type EvidenceFactSource } from "./rules.ts";

const claim = (id: string, type: string, status: string, value: string | number): EvidenceFactSource => ({
  id, type, status, imageId: null, claims: { power_kw: value }
});

describe("ADR-010 field resolution", () => {
  it("keeps pending Strong readings as candidates and flags a different pending value", () => {
    const pending = claim("a", "FACTORY_SPEC_SHEET", "PENDING", 5);
    const accepted = { ...pending, status: "ACCEPTED" };
    expect(resolveEvidenceField("power_kw", [pending])).toMatchObject({ status: "UNVERIFIED", value: 5 });
    expect(resolveEvidenceField("power_kw", [accepted, claim("b", "PACKAGING_PHOTO", "PENDING", 7)]))
      .toMatchObject({ status: "CONFLICT", value: null, evidenceIds: ["a", "b"] });
    expect(resolveEvidenceField("power_kw", [accepted, claim("b", "PACKAGING_PHOTO", "REJECTED", 7)]))
      .toMatchObject({ status: "VERIFIED", value: 5 });
  });
  it("requires different Medium types or field-level confirmation, and never verifies Weak alone", () => {
    const carton = claim("a", "PACKAGING_PHOTO", "ACCEPTED", 5);
    expect(resolveEvidenceField("power_kw", [carton, { ...carton, id: "b" }]).status).toBe("UNVERIFIED");
    expect(resolveEvidenceField("power_kw", [carton, claim("c", "SUPPLIER_CATALOG", "ACCEPTED", 5)]).status).toBe("VERIFIED");
    expect(resolveEvidenceField("power_kw", [carton], { confirmedEvidenceId: "a" }).status).toBe("VERIFIED");
    expect(resolveEvidenceField("power_kw", [claim("d", "PUBLIC_WEB", "ACCEPTED", 5)], { confirmedEvidenceId: "d" }).status).toBe("UNVERIFIED");
    expect(resolveEvidenceField("power_kw", []).status).toBe("NOT_FOUND");
  });
  it("requires accepted inspection and both reference photos for document-free MEDIUM", () => {
    const inspection = claim("a", "ADMIN_PHYSICAL_INSPECTION", "ACCEPTED", "manual");
    const input = { kind: "HOUSE_DEFINED" as const, productTypeSet: true, referencePhotos: true, unique: true,
      distinguishingAttributes: ["power_kw"], decisions: new Map([["power_kw", { notDeterminableReason: "No reading" }]]), fields: new Map(), items: [inspection] };
    expect(computeIdentity(input)).toMatchObject({ level: "MEDIUM", ruleVersion: "identity-rule-v1", evidenceIds: ["a"] });
    expect(computeIdentity({ ...input, referencePhotos: false }).level).toBe("LOW");
    expect(computeIdentity({ ...input, items: [{ ...inspection, status: "PENDING" }] }).level).toBe("LOW");
    expect(evidenceSensitivity("SUPPLIER_DOCUMENT", true)).toBe("INTERNAL_ONLY");
    expect(evidenceSensitivity("MEASUREMENT", false)).toBe("INTERNAL_ONLY");
  });
  it("uses only a positive verified difference to distinguish variants", () => {
    const a = new Map([["power_kw", { status: "VERIFIED" as const, value: 5 }]]);
    expect(hasVerifiedDifference(a, new Map())).toBe(false);
    expect(hasVerifiedDifference(a, new Map([["power_kw", { status: "UNVERIFIED", value: 7 }]]))).toBe(false);
    expect(hasVerifiedDifference(a, new Map([["power_kw", { status: "VERIFIED", value: 7 }]]))).toBe(true);
  });
  it.each([[true, "HIGH"], [false, "MEDIUM"]] as const)("requires manufacturer uniqueness with Strong evidence: %s", (strong, expected) => {
    const verified = (value: string) => ({ status: "VERIFIED" as const, value, strong, evidenceIds: ["plate"] });
    const input = { kind: "MANUFACTURER_IDENTIFIED" as const, productTypeSet: true, referencePhotos: false,
      unique: true, fields: new Map([["brand", verified("HIROMIKI")], ["model_code", verified("178FE")]]),
      decisions: new Map(), distinguishingAttributes: ["wheel_type"], items: [] };
    expect(computeIdentity(input).level).toBe(expected);
    expect(computeIdentity({ ...input, unique: false }).level).toBe("LOW");
  });
});

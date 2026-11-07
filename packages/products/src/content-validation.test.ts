import { expect, it } from "vitest";
import { validateCanonicalDraft, type CanonicalContentContext, type ContentValidationRules } from "./content-validation.ts";

const context: CanonicalContentContext = {
  identityKind: "MANUFACTURER_IDENTIFIED", typeNameKa: "", typeNameEn: "", typeAliases: [], distinguishing: [],
  facts: { model_code: { value: "MMA-200A", labelKa: "მოდელი", labelEn: "Model" } }
};
const rules: ContentValidationRules = {
  catalogBrands: [], confidentialTerms: [], synonyms: {},
  parameters: [{ key: "current_a", labels: ["დენი", "Current"], unit: "A" }]
};
const validate = (text: string, facts = context.facts) => validateCanonicalDraft({
  displayName: "", shortDescription: text, fullDescription: "", searchAliases: []
}, { ...context, facts }, rules);

it.each(["MMA-200A", "mma–200a", "MMA-200A-ის", "MMA-200A, MMA-200A"])(
  "recognizes verified model %s before interpreting its unit-like numbers", (text) => {
    expect(validate(text)).toEqual({ issues: [], facts: { model_code: "MMA-200A" } });
    expect(validate(text, { ...context.facts, current_a: { value: 180, labelKa: "დენი", labelEn: "Current", unit: "A" } }))
      .toEqual({ issues: [], facts: { model_code: "MMA-200A" } });
  }
);

it("gives an exact verified numeric model precedence over its apparent unit", () => {
  expect(validate("200A", { model_code: { ...context.facts.model_code!, value: "200A" } }))
    .toEqual({ issues: [], facts: { model_code: "200A" } });
});

it.each(["200 A", "200A"])("checks standalone %s against verified current outside the model name", (quantity) => {
  for (const text of [quantity, `MMA-200A; ${quantity}`]) {
    for (const facts of [context.facts, {
      ...context.facts, current_a: { value: 180, labelKa: "დენი", labelEn: "Current", unit: "A" }
    }]) {
      expect(validate(text, facts).issues).toEqual([
        { field: "shortDescription", code: "UNVERIFIED_TECHNICAL_VALUE", phrase: quantity }
      ]);
    }
    expect(validate(text, {
      ...context.facts, current_a: { value: 200, labelKa: "დენი", labelEn: "Current", unit: "A" }
    })).toEqual({ issues: [], facts: {
      ...(text.includes("MMA-") ? { model_code: "MMA-200A" } : {}), current_a: 200
    } });
  }
});

it.each(["MMA-250A", "MMA-200AX", "XMMA-200A"])("rejects unverified model code %s", (text) => {
  expect(validate(text).issues).toContainEqual({ field: "shortDescription", code: "UNVERIFIED_MODEL", phrase: text });
});

it("does not use verified current as evidence for an unverified model", () => {
  expect(validate("MMA-250A", {
    ...context.facts, current_a: { value: 250, labelKa: "დენი", labelEn: "Current", unit: "A" }
  }).issues).toEqual([{ field: "shortDescription", code: "UNVERIFIED_MODEL", phrase: "MMA-250A" }]);
});

it("applies model precedence to every canonical content field and alias", () => {
  expect(validateCanonicalDraft({ displayName: "MMA-200A", shortDescription: "MMA-200A",
    fullDescription: "MMA-200A", searchAliases: ["MMA-200A"] }, context, rules))
    .toEqual({ issues: [], facts: { model_code: "MMA-200A" } });
});

import type { EvidenceValue } from "@khidi/db";
import { generateDeterministicDisplayNames, transliterateGeorgianToAscii } from "./naming.ts";
import { normalizePowerToKw } from "./units.ts";

export interface CanonicalDraft {
  displayName: string;
  shortDescription: string;
  fullDescription: string;
  searchAliases: string[];
}
export interface CanonicalFact {
  value: EvidenceValue;
  labelKa: string;
  labelEn: string;
  unit?: string;
}
export interface CanonicalContentContext {
  identityKind: string;
  typeNameKa: string;
  typeNameEn: string;
  typeAliases: string[];
  distinguishing: string[];
  facts: Record<string, CanonicalFact>;
}

const internalText = /\bagro\s*trade\b|\bkh[-\s]?\d{6,}|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b|https?:\/\/|(?:\b|\.)khidi\.(?:app|internal\.local)\b|\S+@\S+\.\S+/iu;
export function isPublicCanonicalText(value: string) {
  return !internalText.test(value.normalize("NFKC"));
}
export function isPublicCanonicalField(key: string) {
  return !/supplier|vendor|invoice|packing|price|cost|currency|address|phone|email|tax_id|internal|document|url|accounting|barcode|gtin/i.test(key);
}

const localWords = {
  ka: "პროდუქტი ტიპი აღწერა მახასიათებლები მონაცემები დადასტურებული და ან არის აქვს მოიცავს გამოიყენება კონფიგურაცია სახელწოდება მოდელი ბრენდი მწარმოებელი მნიშვნელობა",
  en: "product type description specifications verified facts and or is has includes with the a an configuration name model brand manufacturer value"
};
const localizedUnits: Record<string, string[]> = {
  kW: ["კვტ"], kg: ["კგ"], mm: ["მმ"], "cm³": ["სმ³"], L: ["ლ"], bar: ["ბარი"], "L/min": ["ლ/წთ"],
  V: ["ვ"], A: ["ა"], HP: ["ცხ.ძ."]
};
const words = (text: string) => text.normalize("NFKC").match(/(?:[+−-](?=\d))?[\p{L}\p{N}]+(?:[.,/\-][\p{L}\p{N}]+)*/gu) ?? [];
const normalize = (token: string) => token.toLowerCase().replace(/^−/, "-").replace(/(?<=\d),(?=\d)/g, ".");
const numericWord = /\d/u;
const unitTokens = new Set(Object.entries(localizedUnits).flatMap(([unit, labels]) => [unit, ...labels])
  .flatMap(words).map(normalize).filter((unit) => unit.length > 1));

function factReadings(fact: CanonicalFact) {
  if (typeof fact.value === "boolean") return fact.value ? ["true", "კი"] : ["false", "არა"];
  if (typeof fact.value === "number" && fact.unit) {
    const units = [fact.unit, ...(localizedUnits[fact.unit] ?? [])];
    const readings = units.flatMap((unit) => [`${fact.value} ${unit}`, `${fact.value}${unit}`]);
    const hp = metricHorsepower(fact);
    return hp === null ? readings : [...readings, `${hp} HP`, `${hp} ცხ.ძ.`];
  }
  return [String(fact.value)];
}

function metricHorsepower(fact: CanonicalFact) {
  if (fact.unit !== "kW" || typeof fact.value !== "number" || fact.value <= 0) return null;
  const candidate = Math.round(fact.value / 0.73549875);
  return candidate > 0 && normalizePowerToKw(`${candidate} HP`).valueKw === fact.value ? candidate : null;
}

function formatFact(fact: CanonicalFact, locale: string) {
  const hp = metricHorsepower(fact);
  if (hp !== null) return `${hp} ${locale === "ka" ? "ცხ.ძ." : "HP"}`;
  const options = factReadings(fact);
  return locale === "ka" && typeof fact.value === "boolean" ? options[1]! : options[0]!;
}

export function generateCanonicalDraft(context: CanonicalContentContext, locale: string): CanonicalDraft {
  const isKa = locale === "ka";
  const typeName = isKa ? context.typeNameKa : context.typeNameEn;
  const value = (field: string) => context.facts[field] ? formatFact(context.facts[field]!, locale) : null;
  const differentiators = context.distinguishing.flatMap((field) => {
    const fact = context.facts[field];
    if (!fact) return [];
    const reading = formatFact(fact, locale);
    const shared = Object.entries(context.facts).some(([other, candidate]) => other !== field && formatFact(candidate, locale) === reading);
    return [shared ? `${isKa ? fact.labelKa : fact.labelEn} ${reading}` : reading];
  }).join(", ");
  const brand = value("brand");
  const names = generateDeterministicDisplayNames({ brand, modelCode: value("model_code"),
    productTypeNameKa: context.typeNameKa, productTypeNameEn: context.typeNameEn,
    keyDifferentiatorKa: differentiators, keyDifferentiatorEn: differentiators });
  const displayName = context.identityKind === "MANUFACTURER_IDENTIFIED" ? (isKa ? names.displayNameKa : names.displayNameEn) ?? typeName
    : [[brand, typeName].filter(Boolean).join(" "), differentiators].filter(Boolean).join(", ");
  const detail = Object.entries(context.facts).filter(([field]) => !["product_type", "brand", "model_code"].includes(field))
    .map(([, fact]) => `${isKa ? fact.labelKa : fact.labelEn}: ${formatFact(fact, locale)}`);
  return {
    displayName, shortDescription: displayName, fullDescription: [displayName, ...detail].join("\n"),
    searchAliases: [...new Set(context.typeAliases.flatMap((alias) => [alias, transliterateGeorgianToAscii(alias)]))]
  };
}

export interface ContentIssue {
  field: keyof CanonicalDraft;
  phrase: string;
  code: "REQUIRED" | "UNVERIFIED_PHRASE" | "INTERNAL_TEXT" | "IDENTITY_NAME" | "AMBIGUOUS_FACT";
}

/**
 * Recognize complete evidence values before ordinary copy. This is intentionally a
 * closed vocabulary so an unfamiliar name or model cannot masquerade as prose.
 */
export function validateCanonicalDraft(draft: CanonicalDraft, context: CanonicalContentContext, locale: string) {
  const issues: ContentIssue[] = [];
  const facts: Record<string, EvidenceValue> = {};
  const matches = Object.entries(context.facts).flatMap(([key, fact]) =>
    factReadings(fact).map((phrase) => ({ key, value: fact.value, tokens: words(phrase).map(normalize) })))
    .filter((match) => match.tokens.length > 0).sort((a, b) => b.tokens.length - a.tokens.length);
  const labels = [context.typeNameKa, context.typeNameEn, ...Object.values(context.facts).flatMap((fact) => [fact.labelKa, fact.labelEn])];
  const vocabulary = new Set(words([localWords[locale === "ka" ? "ka" : "en"], ...labels].join(" ")).map(normalize));
  const aliases = new Set([...context.typeAliases, ...context.typeAliases.map(transliterateGeorgianToAscii)].flatMap(words).map(normalize));
  const check = (field: keyof CanonicalDraft, text: string) => {
    if (!text.trim() && field !== "searchAliases") {
      issues.push({ field, phrase: "", code: "REQUIRED" });
      return;
    }
    if (!isPublicCanonicalText(text)) {
      issues.push({ field, phrase: text, code: "INTERNAL_TEXT" });
      return;
    }
    const raw = words(text), tokens = raw.map(normalize), used = new Set<string>();
    for (let i = 0; i < tokens.length;) {
      const readings = matches.filter(({ tokens: reading }) => reading.every((token, offset) => token === tokens[i + offset]));
      const length = readings[0]?.tokens.length ?? 0;
      if (length) {
        const longest = [...new Map(readings.filter((entry) => entry.tokens.length === length).map((entry) => [entry.key, entry])).values()];
        const labeled = longest.filter(({ key }) => [context.facts[key]!.labelKa, context.facts[key]!.labelEn]
          .some((label) => {
            const prefix = words(label).map(normalize);
            return prefix.length > 0 && prefix.length <= i && prefix.every((token, index) => token === tokens[i - prefix.length + index]);
          }));
        const brand = longest.find((reading) => reading.key === "brand");
        const brandAndManufacturer = longest.length === 2 && brand && longest.some((reading) => reading.key === "manufacturer");
        const resolved = labeled.length === 1 ? labeled : brandAndManufacturer ? [brand] : longest;
        if (resolved.length > 1) issues.push({ field, phrase: raw.slice(i, i + length).join(" "), code: "AMBIGUOUS_FACT" });
        else for (const reading of resolved) {
          if (field !== "searchAliases") facts[reading.key] = reading.value;
          used.add(reading.key);
        }
        i += length;
        continue;
      }
      const token = tokens[i]!;
      if (numericWord.test(token) || unitTokens.has(token) || !(vocabulary.has(token) || (field === "searchAliases" && aliases.has(token)))) {
        issues.push({ field, phrase: raw[i]!, code: "UNVERIFIED_PHRASE" });
      }
      i++;
    }
    if (field === "displayName") {
      const type = words(locale === "ka" ? context.typeNameKa : context.typeNameEn).map(normalize);
      const containsType = type.length && tokens.some((_, i) => type.every((word, offset) => tokens[i + offset] === word));
      const validIdentity = context.identityKind === "MANUFACTURER_IDENTIFIED" ? used.has("brand") && used.has("model_code") : !used.has("model_code");
      if (!containsType || !validIdentity) issues.push({ field, phrase: text, code: "IDENTITY_NAME" });
    }
  };
  check("displayName", draft.displayName);
  check("shortDescription", draft.shortDescription);
  check("fullDescription", draft.fullDescription);
  for (const alias of draft.searchAliases) check("searchAliases", alias);
  return { issues, facts };
}

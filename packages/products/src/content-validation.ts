import type { EvidenceValue } from "@khidi/db";
import { listTechnicalTermGroups, normalizeContentText, type TechnicalSynonyms } from "./content-terms.ts";
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

function metricHorsepower(fact: CanonicalFact) {
  if (fact.unit !== "kW" || typeof fact.value !== "number" || fact.value <= 0) return null;
  const candidate = Math.round(fact.value / 0.73549875);
  return candidate > 0 && normalizePowerToKw(`${candidate} HP`).valueKw === fact.value ? candidate : null;
}

function formatFact(fact: CanonicalFact, locale: string) {
  const hp = metricHorsepower(fact);
  if (hp !== null) return `${hp} ${locale === "ka" ? "ცხ.ძ." : "HP"}`;
  if (locale === "ka" && typeof fact.value === "boolean") return fact.value ? "კი" : "არა";
  return typeof fact.value === "number" && fact.unit ? `${fact.value} ${fact.unit}` : String(fact.value);
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
  code: "UNVERIFIED_BRAND" | "UNVERIFIED_MODEL" | "UNVERIFIED_TECHNICAL_VALUE" | "INTERNAL_TEXT";
}

export interface ContentValidationRules {
  catalogBrands: readonly string[];
  confidentialTerms: readonly string[];
  synonyms: TechnicalSynonyms;
  parameters: readonly { key: string; labels: readonly string[]; unit?: string }[];
}

const wordStart = String.raw`(?<![\p{L}\p{M}\p{N}])`;
const wordEnd = String.raw`(?![\p{L}\p{M}\p{N}])`;
const numberPattern = String.raw`[+-]?(?:\p{Nd}{1,3}(?: \p{Nd}{3})+(?:[.,]\p{Nd}+)?|\p{Nd}+(?:[.,]\p{Nd}+)?|[.,]\p{Nd}+)`;
const modelTokens = /[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*/gu;
const literal = (value: string) => normalizeContentText(value.trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sameText = (left: string, right: string) => normalizeContentText(left).toLowerCase() === normalizeContentText(right).toLowerCase();
const findLiteral = (text: string, value: string) => value.trim()
  ? new RegExp(`${wordStart}${literal(value)}${wordEnd}`, "iu").exec(text) : null;
const currency = `(?:${Intl.supportedValuesOf("currency").join("|")}|gel|usd|cny|eur|gbp|jpy|rub|cad|aud|inr|ლარი|ლარის|თეთრი)`;
const amount = String.raw`[+-]?\p{Nd}+(?:[., '’]\p{Nd}+)*`;
const currencySymbol = String.raw`\p{Sc}`;
const currencyAmount = new RegExp(
  `${wordStart}${currency} *${amount}${wordEnd}|${wordStart}${amount} *${currency}${wordEnd}|${currencySymbol} *${amount}|${amount} *${currencySymbol}`, "u"
);
const internalSkuOrHub = /(?<![\p{L}\p{N}])(?:KH-[\p{Nd}]+|(?:[a-z\d-]+\.)*khidi\.(?:app|internal\.local))(?![\p{L}\p{N}])/iu;

export function findConfidentialPhrase(raw: string, confidentialTerms: readonly string[]) {
  const text = normalizeContentText(raw);
  const fixed = internalSkuOrHub.exec(text) ?? currencyAmount.exec(text);
  if (fixed) return fixed[0];
  for (const term of confidentialTerms) {
    const match = findLiteral(text, term);
    if (match) return match[0];
  }
  return null;
}

function numericValue(raw: string) {
  return Number(raw.replaceAll(" ", "").replace(",", ".").replace(/\p{Nd}/gu, (digit) => {
    const point = digit.codePointAt(0)!;
    let first = point;
    while (/\p{Nd}/u.test(String.fromCodePoint(first - 1))) first--;
    return String((point - first) % 10);
  }));
}

function technicalMatcher(rules: ContentValidationRules) {
  const units = new Map<string, { unit: string; fields: Set<string> }>();
  const parameters = new Map<string, Set<string>>();
  const keyOf = (term: string) => normalizeContentText(term).toLowerCase();
  for (const { unit, fields, aliases } of listTechnicalTermGroups(rules.synonyms)) {
    for (const term of [unit, ...aliases].filter(Boolean)) units.set(keyOf(term), { unit, fields: new Set(fields) });
  }
  for (const { key, labels, unit } of rules.parameters) {
    for (const label of labels.filter(Boolean)) {
      const fields = parameters.get(keyOf(label)) ?? new Set();
      fields.add(key);
      parameters.set(keyOf(label), fields);
    }
    if (unit) {
      const existing = units.get(keyOf(unit)) ?? { unit, fields: new Set() };
      existing.fields.add(key);
      units.set(keyOf(unit), existing);
    }
  }
  const alternatives = (terms: Iterable<string>) => [...terms].sort((a, b) => b.length - a.length).map(literal).join("|");
  const suffix = new RegExp(`^ *(?:- *)?(${alternatives(new Set([...units.keys(), ...parameters.keys()]))})${wordEnd}`, "iu");
  const prefixTerms = alternatives(new Set([...parameters.keys(), ...[...units.keys()].filter((term) => term.length > 1)]));
  const prefix = new RegExp(`${wordStart}(${prefixTerms})(?: *[:=])?$`, "iu");
  return (text: string) => [...text.matchAll(new RegExp(`${wordStart}${numberPattern}`, "gu"))].flatMap((number) => {
    const index = number.index;
    const end = index + number[0].length;
    const afterMatch = suffix.exec(text.slice(end));
    const after = afterMatch?.[1] === "a" && afterMatch[0].startsWith(" ") ? null : afterMatch;
    const beforeText = text.slice(0, index).trimEnd();
    const before = prefix.exec(beforeText);
    const following = after?.[1] ? keyOf(after[1]) : undefined;
    const preceding = before?.[1] ? keyOf(before[1]) : undefined;
    const unit = following ? units.get(following) : preceding ? units.get(preceding) : undefined;
    const labelFields = (preceding ? parameters.get(preceding) : undefined) ?? (following ? parameters.get(following) : undefined);
    if ((!after && /[\p{L}\p{M}\p{N}]/u.test(text[end] ?? "")) || (!unit && !labelFields)) return [];
    const fields = unit ? [...unit.fields].filter((key) => !labelFields || labelFields.has(key)) : [...labelFields!];
    const reading = numericValue(number[0]);
    const value = (unit?.unit === "HP" || unit?.unit === "W") && reading > 0
      ? (/^\d+(?:\.\d+)?$/.test(String(reading)) ? normalizePowerToKw(`${reading} ${unit.unit}`).valueKw : NaN)
      : reading;
    const start = preceding ? before!.index : index;
    return [{ fields, value, start, end: end + (after?.[0].length ?? 0), numberStart: index, hasUnit: !!unit }];
  });
}

export function validateCanonicalDraft(draft: CanonicalDraft, context: CanonicalContentContext, rules: ContentValidationRules) {
  const issues: ContentIssue[] = [];
  const facts: Record<string, EvidenceValue> = {};
  const readTechnical = technicalMatcher(rules);
  const { brand, model_code: model } = context.facts;
  const check = (field: keyof CanonicalDraft, raw: string) => {
    const text = normalizeContentText(raw);
    const reject = (code: ContentIssue["code"], phrase: string) => issues.push({ field, code, phrase });
    const cite = (key: string, fact: CanonicalFact) => { if (field !== "searchAliases") facts[key] = fact.value; };
    const privatePhrase = findConfidentialPhrase(text, rules.confidentialTerms);
    if (privatePhrase) reject("INTERNAL_TEXT", privatePhrase);
    const recognized = readTechnical(text);
    for (const { fields, value, start, end, numberStart, hasUnit } of recognized) {
      const matched = fields.filter((key) => {
        const reading = context.facts[key]?.value;
        if (typeof reading === "number") return reading === value;
        if (typeof reading !== "string") return false;
        if (/^\d+$/.test(reading)) return Number(reading) === value;
        return !hasUnit && findLiteral(text.slice(numberStart), reading)?.index === 0;
      });
      if (!matched.length) reject("UNVERIFIED_TECHNICAL_VALUE", text.slice(start, end));
      else for (const key of matched) cite(key, context.facts[key]!);
    }
    for (const known of rules.catalogBrands) {
      if (brand && sameText(String(brand.value), known)) continue;
      const match = findLiteral(text, known);
      if (match) reject("UNVERIFIED_BRAND", match[0]);
    }
    const identityPhrases = [brand, model].flatMap((fact) => fact
      ? [...text.matchAll(new RegExp(`${wordStart}${literal(String(fact.value))}${wordEnd}`, "giu"))]
        .map((match) => ({ start: match.index, end: match.index + match[0].length })) : []);
    const covered = [...identityPhrases, ...recognized];
    for (const token of text.matchAll(modelTokens)) {
      const phrase = token[0];
      const code = phrase.replace(/-(?:ში|ის|ზე|ით|დან|მდე|თან|ს|მა)$/u, "");
      if (!/\p{L}/u.test(code) || !/\p{Nd}/u.test(code)
        || (model && sameText(code, String(model.value)))
        || covered.some(({ start, end }) => start <= token.index && end >= token.index + code.length)) continue;
      reject("UNVERIFIED_MODEL", phrase);
    }
    // Known literals are tracked for evidence-change notices even when the prose is unrestricted.
    for (const [key, fact] of Object.entries(context.facts)) {
      const readings = typeof fact.value === "boolean" ? [String(fact.value), fact.value ? "კი" : "არა"] : [String(fact.value)];
      if (typeof fact.value !== "number" && readings.some((reading) => findLiteral(text, reading))) cite(key, fact);
    }
  };
  check("displayName", draft.displayName);
  check("shortDescription", draft.shortDescription);
  check("fullDescription", draft.fullDescription);
  for (const alias of draft.searchAliases) check("searchAliases", alias);
  return { issues, facts };
}

import { AppError } from "@khidi/shared";

const GEORGIAN_TO_ASCII_MAP: Record<string, string> = {
  ა: "a",
  ბ: "b",
  გ: "g",
  დ: "d",
  ე: "e",
  ვ: "v",
  ზ: "z",
  თ: "t",
  ი: "i",
  კ: "k",
  ლ: "l",
  მ: "m",
  ნ: "n",
  ო: "o",
  პ: "p",
  ჟ: "zh",
  რ: "r",
  ს: "s",
  ტ: "t",
  უ: "u",
  ფ: "p",
  ქ: "k",
  ღ: "gh",
  ყ: "q",
  შ: "sh",
  ჩ: "ch",
  ც: "ts",
  ძ: "dz",
  წ: "ts",
  ჭ: "ch",
  ხ: "kh",
  ჯ: "j",
  ჰ: "h"
};

export function transliterateGeorgianToAscii(input: string): string {
  let out = "";
  for (const ch of input) {
    out += GEORGIAN_TO_ASCII_MAP[ch] ?? ch;
  }
  return out;
}

export interface DeterministicNamingInput {
  brand?: string | null;
  modelCode?: string | null;
  productTypeNameKa: string;
  productTypeNameEn: string;
  keyDifferentiatorKa?: string | null;
  keyDifferentiatorEn?: string | null;
}

/**
 * §5.10 Deterministic Naming Engine:
 * [Brand] [Model] — [Product Type], [Key differentiator]
 * Example KA: "HIROMIKI D178E-DF900Q — მოტობლოკი, 9 ცხ.ძ."
 * Example EN: "HIROMIKI D178E-DF900Q — Motoblock, 9 HP"
 * Unknown differentiator -> omit it. Never invent.
 */
export function generateDeterministicDisplayNames(input: DeterministicNamingInput): {
  displayNameKa: string | null;
  displayNameEn: string | null;
} {
  const brand = input.brand?.trim() ?? "";
  const model = input.modelCode?.trim() ?? "";
  const typeKa = input.productTypeNameKa.trim();
  const typeEn = input.productTypeNameEn.trim();
  const diffKa = input.keyDifferentiatorKa?.trim() ?? "";
  const diffEn = input.keyDifferentiatorEn?.trim() ?? "";

  if (!brand && !model) {
    return { displayNameKa: null, displayNameEn: null };
  }

  const head = [brand, model].filter(Boolean).join(" ");
  const tailKa = diffKa ? `${typeKa}, ${diffKa}` : typeKa;
  const tailEn = diffEn ? `${typeEn}, ${diffEn}` : typeEn;

  return {
    displayNameKa: `${head} — ${tailKa}`,
    displayNameEn: `${head} — ${tailEn}`
  };
}

/**
 * §5.11 & [C8] Canonical ASCII Slug Generator:
 * Generates a deterministic ASCII slug (e.g. `hiromiki-d178e-df900q`) from verified brand and model.
 * Only called when a SKU transitions to `READY` or when an admin explicitly updates the slug on a READY SKU.
 */
export function generateCanonicalSlug(
  brand: string | null | undefined,
  modelCode: string | null | undefined,
  differentiatorOrInternalSku?: string | null
): string {
  const rawParts = [brand?.trim(), modelCode?.trim()].filter(Boolean);
  if (rawParts.length === 0 && differentiatorOrInternalSku?.trim()) {
    rawParts.push(differentiatorOrInternalSku.trim());
  }

  const combined = transliterateGeorgianToAscii(rawParts.join("-"))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (!combined) {
    throw new AppError(
      "PRECONDITION_FAILED",
      "Cannot generate canonical_slug: verified brand or model_code is required before transitioning to READY [C8]."
    );
  }

  return combined;
}

/**
 * §12.5 Legacy URL Path Normalizer:
 * Handles percent-encoded and decoded Georgian paths, lowercases ASCII characters safely,
 * and normalizes trailing slashes.
 */
export function normalizeLegacyUrlPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new AppError("VALIDATION_ERROR", "Legacy URL path cannot be empty.");
  }

  // Strip scheme/host if accidentally passed, keep path + query if any
  let pathOnly = trimmed;
  if (/^https?:\/\//i.test(pathOnly)) {
    const parsed = new URL(pathOnly);
    pathOnly = parsed.pathname + parsed.search;
  }

  let decoded = pathOnly;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    // Keep raw if malformed percent sequence
    decoded = pathOnly;
  }

  if (!decoded.startsWith("/")) {
    decoded = `/${decoded}`;
  }

  // Collapse multiple slashes
  decoded = decoded.replace(/\/{2,}/g, "/");

  // Lowercase ASCII letters safely while preserving Georgian Mkhedruli
  decoded = decoded.replace(/[A-Z]+/g, (m) => m.toLowerCase());

  // Normalize trailing slash (remove trailing slash unless path is root "/")
  if (decoded.length > 1 && decoded.endsWith("/")) {
    decoded = decoded.slice(0, -1);
  }

  return decoded;
}

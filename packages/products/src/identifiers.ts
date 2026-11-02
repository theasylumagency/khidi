import { AppError } from "@khidi/shared";

/**
 * Computes the standard GS1 Modulo-10 check digit for the payload digits (excluding the check digit).
 * Moving from rightmost payload digit to left, multipliers alternate 3, 1, 3, 1...
 */
export function computeGs1CheckDigit(payloadDigits: string): number {
  let sum = 0;
  for (let i = 0; i < payloadDigits.length; i += 1) {
    const digit = Number(payloadDigits[payloadDigits.length - 1 - i]);
    const weight = i % 2 === 0 ? 3 : 1;
    sum += digit * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Validates a GTIN-8, GTIN-12 (UPC-A), GTIN-13 (EAN-13), or GTIN-14 string
 * against the GS1 Modulo-10 check digit and normalizes it to 14-digit GTIN-14.
 */
export function normalizeAndValidateGtin14(rawInput: string): string {
  const stripped = rawInput.replace(/[\s-]+/g, "");
  if (!/^\d+$/.test(stripped)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `GTIN/UPC must contain only digits (received "${rawInput}").`
    );
  }

  if (
    stripped.length !== 8 &&
    stripped.length !== 12 &&
    stripped.length !== 13 &&
    stripped.length !== 14
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      `GTIN/UPC must be 8, 12, 13, or 14 digits long (received ${stripped.length} digits in "${rawInput}").`
    );
  }

  const payload = stripped.slice(0, -1);
  const actualCheck = Number(stripped.slice(-1));
  const expectedCheck = computeGs1CheckDigit(payload);

  if (actualCheck !== expectedCheck) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Invalid GS1 check digit in "${rawInput}": expected ${expectedCheck}, got ${actualCheck}.`
    );
  }

  return stripped.padStart(14, "0");
}

/**
 * Normalizes an identifier value on write.
 * - GTIN and UPC are both validated and normalized to canonical 14-digit GTIN-14,
 *   and stored with `identifierType = "GTIN"` so UPC-A (12 digits) and EAN-13 (13 digits with leading 0)
 *   always resolve to the exact same canonical representation.
 */
export function normalizeIdentifierOnWrite(
  identifierType: string,
  rawValue: string
): { canonicalType: string; canonicalValue: string } {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new AppError("VALIDATION_ERROR", "Identifier value cannot be empty.");
  }

  if (identifierType === "GTIN" || identifierType === "UPC") {
    return {
      canonicalType: "GTIN",
      canonicalValue: normalizeAndValidateGtin14(trimmed)
    };
  }

  return {
    canonicalType: identifierType,
    canonicalValue: trimmed
  };
}

/**
 * Returns candidate normalized values for scanner lookup.
 * If the scanned string is an 8, 12, 13, or 14 digit valid GS1 barcode, includes its GTIN-14 form.
 */
export function buildCandidateLookupValues(scannedRaw: string): string[] {
  const trimmed = scannedRaw.trim();
  if (!trimmed) return [];

  const candidates = new Set<string>([trimmed]);
  const digitsOnly = trimmed.replace(/[\s-]+/g, "");
  if (/^\d+$/.test(digitsOnly) && [8, 12, 13, 14].includes(digitsOnly.length)) {
    try {
      const gtin14 = normalizeAndValidateGtin14(digitsOnly);
      candidates.add(gtin14);
    } catch {
      // Not a valid GS1 barcode (e.g. a numeric supplier code); still search raw value
    }
  }

  return [...candidates];
}

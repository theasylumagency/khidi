import type { SkuUnitMetadataEntry } from "@khidi/db";
import { AppError } from "@khidi/shared";

export const UNIVERSAL_UNIT_KEYS = [
  "power_kw",
  "engine_displacement_cm3",
  "length_mm",
  "width_mm",
  "height_mm",
  "working_width_mm",
  "working_depth_mm",
  "weight_kg",
  "volume_l",
  "pressure_bar",
  "flow_l_min",
  "voltage_v",
  "current_a"
] as const;

export type UniversalUnitKey = (typeof UNIVERSAL_UNIT_KEYS)[number];

export interface UniversalUnitStructuredInput {
  value: string | number | null;
  status: "VERIFIED" | "UNVERIFIED" | "NOT_FOUND" | "CONFLICT";
  sourceType?: string;
  evidenceId?: string;
  verifiedBy?: string;
  verifiedAt?: string;
}

export type UniversalUnitFieldInput = string | number | UniversalUnitStructuredInput | null | undefined;

export interface UniversalUnitsInput {
  power?: UniversalUnitFieldInput;
  engineDisplacement?: UniversalUnitFieldInput;
  length?: UniversalUnitFieldInput;
  width?: UniversalUnitFieldInput;
  height?: UniversalUnitFieldInput;
  workingWidth?: UniversalUnitFieldInput;
  workingDepth?: UniversalUnitFieldInput;
  weight?: UniversalUnitFieldInput;
  volume?: UniversalUnitFieldInput;
  pressure?: UniversalUnitFieldInput;
  flow?: UniversalUnitFieldInput;
  voltage?: UniversalUnitFieldInput;
  current?: UniversalUnitFieldInput;
}

export interface NormalizedUniversalUnits {
  powerKw: string | null;
  engineDisplacementCm3: string | null;
  lengthMm: string | null;
  widthMm: string | null;
  heightMm: string | null;
  workingWidthMm: string | null;
  workingDepthMm: string | null;
  weightKg: string | null;
  volumeL: string | null;
  pressureBar: string | null;
  flowLMin: string | null;
  voltageV: string | null;
  currentA: string | null;
  unitSourceStringsJson: Record<string, string>;
  unitMetadataJson: Record<string, SkuUnitMetadataEntry>;
}

const METRIC_HP_TO_KW = 0.73549875; // §5.6: 9 HP -> 6.62 kW

function parseLeadingNumber(raw: string, fieldName: string): { num: number; unitPart: string } {
  const trimmed = raw.trim().replace(",", ".");
  const match = /^([+-]?\d+(?:\.\d+)?)\s*(.*)$/i.exec(trimmed);
  if (!match || !match[1]) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Cannot parse numeric value from "${raw}" for ${fieldName}.`,
      { field: fieldName, raw }
    );
  }
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Unit value for ${fieldName} must be a positive number (received "${raw}").`,
      { field: fieldName, raw }
    );
  }
  return { num, unitPart: (match[2] ?? "").trim().toLowerCase() };
}

/**
 * §5.6 Normalizes power into kW.
 * Examples:
 * - "9 HP" -> 6.62
 * - "9 ცხ.ძ." -> 6.62
 * - "6.6 kW" -> 6.6
 * - "2200 W" -> 2.2
 */
export function normalizePowerToKw(input: string | number): {
  valueKw: number;
  sourceString: string;
} {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input <= 0) {
      throw new AppError("VALIDATION_ERROR", "Power must be a positive number.");
    }
    const rounded = Number(input.toFixed(2));
    return { valueKw: rounded, sourceString: `${input} kW` };
  }

  const sourceString = input.trim();
  const { num, unitPart } = parseLeadingNumber(sourceString, "power_kw");

  if (
    unitPart === "hp" ||
    unitPart === "ps" ||
    unitPart === "ცხ.ძ." ||
    unitPart === "ცხ.ძ" ||
    unitPart === "ცხენის ძალა"
  ) {
    return {
      valueKw: Number((num * METRIC_HP_TO_KW).toFixed(2)),
      sourceString
    };
  }

  if (unitPart === "w" || unitPart === "ვტ" || unitPart === "ვატი") {
    return {
      valueKw: Number((num / 1000).toFixed(3)),
      sourceString
    };
  }

  if (unitPart === "" || unitPart === "kw" || unitPart === "კვტ") {
    return {
      valueKw: Number(num.toFixed(2)),
      sourceString
    };
  }

  throw new AppError("VALIDATION_ERROR", `Unsupported power unit in "${sourceString}".`);
}

export function normalizeDisplacementToCm3(input: string | number): {
  valueCm3: number;
  sourceString: string;
} {
  if (typeof input === "number") {
    return { valueCm3: Number(input.toFixed(2)), sourceString: `${input} cm3` };
  }
  const sourceString = input.trim();
  const { num, unitPart } = parseLeadingNumber(sourceString, "engine_displacement_cm3");

  if (
    unitPart === "" ||
    unitPart === "cc" ||
    unitPart === "cm3" ||
    unitPart === "cm³" ||
    unitPart === "სმ3" ||
    unitPart === "სმ³"
  ) {
    return { valueCm3: Number(num.toFixed(2)), sourceString };
  }
  if (unitPart === "l" || unitPart === "ლ") {
    return { valueCm3: Number((num * 1000).toFixed(2)), sourceString };
  }
  throw new AppError("VALIDATION_ERROR", `Unsupported displacement unit in "${sourceString}".`);
}

export function normalizeLengthToMm(
  input: string | number,
  fieldName = "length_mm"
): { valueMm: number; sourceString: string } {
  if (typeof input === "number") {
    return { valueMm: Number(input.toFixed(2)), sourceString: `${input} mm` };
  }
  const sourceString = input.trim();
  const { num, unitPart } = parseLeadingNumber(sourceString, fieldName);

  if (unitPart === "" || unitPart === "mm" || unitPart === "მმ") {
    return { valueMm: Number(num.toFixed(2)), sourceString };
  }
  if (unitPart === "cm" || unitPart === "სმ") {
    return { valueMm: Number((num * 10).toFixed(2)), sourceString };
  }
  if (unitPart === "m" || unitPart === "მ") {
    return { valueMm: Number((num * 1000).toFixed(2)), sourceString };
  }
  throw new AppError("VALIDATION_ERROR", `Unsupported dimension unit in "${sourceString}".`);
}

export function normalizeWeightToKg(input: string | number): {
  valueKg: number;
  sourceString: string;
} {
  if (typeof input === "number") {
    return { valueKg: Number(input.toFixed(3)), sourceString: `${input} kg` };
  }
  const sourceString = input.trim();
  const { num, unitPart } = parseLeadingNumber(sourceString, "weight_kg");

  if (unitPart === "" || unitPart === "kg" || unitPart === "კგ") {
    return { valueKg: Number(num.toFixed(3)), sourceString };
  }
  if (unitPart === "g" || unitPart === "გ" || unitPart === "გრ") {
    return { valueKg: Number((num / 1000).toFixed(3)), sourceString };
  }
  if (unitPart === "t" || unitPart === "ton" || unitPart === "ტ" || unitPart === "ტონა") {
    return { valueKg: Number((num * 1000).toFixed(3)), sourceString };
  }
  throw new AppError("VALIDATION_ERROR", `Unsupported weight unit in "${sourceString}".`);
}

export function normalizeVolumeToL(input: string | number): {
  valueL: number;
  sourceString: string;
} {
  if (typeof input === "number") {
    return { valueL: Number(input.toFixed(3)), sourceString: `${input} L` };
  }
  const sourceString = input.trim();
  const { num, unitPart } = parseLeadingNumber(sourceString, "volume_l");

  if (unitPart === "" || unitPart === "l" || unitPart === "ლ" || unitPart === "ლიტრი") {
    return { valueL: Number(num.toFixed(3)), sourceString };
  }
  if (unitPart === "ml" || unitPart === "მლ") {
    return { valueL: Number((num / 1000).toFixed(3)), sourceString };
  }
  throw new AppError("VALIDATION_ERROR", `Unsupported volume unit in "${sourceString}".`);
}

export function normalizePressureToBar(input: string | number): {
  valueBar: number;
  sourceString: string;
} {
  if (typeof input === "number") {
    return { valueBar: Number(input.toFixed(2)), sourceString: `${input} bar` };
  }
  const sourceString = input.trim();
  const { num, unitPart } = parseLeadingNumber(sourceString, "pressure_bar");

  if (unitPart === "" || unitPart === "bar" || unitPart === "ბარი" || unitPart === "ბარ") {
    return { valueBar: Number(num.toFixed(2)), sourceString };
  }
  if (unitPart === "mpa" || unitPart === "მპა") {
    return { valueBar: Number((num * 10).toFixed(2)), sourceString };
  }
  if (unitPart === "psi") {
    return { valueBar: Number((num * 0.0689476).toFixed(2)), sourceString };
  }
  throw new AppError("VALIDATION_ERROR", `Unsupported pressure unit in "${sourceString}".`);
}

export function normalizeFlowToLMin(input: string | number): {
  valueLMin: number;
  sourceString: string;
} {
  if (typeof input === "number") {
    return { valueLMin: Number(input.toFixed(2)), sourceString: `${input} L/min` };
  }
  const sourceString = input.trim();
  const { num, unitPart } = parseLeadingNumber(sourceString, "flow_l_min");

  if (
    unitPart === "" ||
    unitPart === "l/min" ||
    unitPart === "l/m" ||
    unitPart === "ლ/წთ"
  ) {
    return { valueLMin: Number(num.toFixed(2)), sourceString };
  }
  if (unitPart === "m3/h" || unitPart === "მ3/სთ" || unitPart === "მ³/სთ") {
    return { valueLMin: Number(((num * 1000) / 60).toFixed(2)), sourceString };
  }
  throw new AppError("VALIDATION_ERROR", `Unsupported flow unit in "${sourceString}".`);
}

export function normalizeVoltageToV(input: string | number): {
  valueV: number;
  sourceString: string;
} {
  if (typeof input === "number") {
    return { valueV: Number(input.toFixed(2)), sourceString: `${input} V` };
  }
  const sourceString = input.trim();
  const { num, unitPart } = parseLeadingNumber(sourceString, "voltage_v");
  if (unitPart === "" || unitPart === "v" || unitPart === "ვ" || unitPart === "ვოლტი") {
    return { valueV: Number(num.toFixed(2)), sourceString };
  }
  throw new AppError("VALIDATION_ERROR", `Unsupported voltage unit in "${sourceString}".`);
}

export function normalizeCurrentToA(input: string | number): {
  valueA: number;
  sourceString: string;
} {
  if (typeof input === "number") {
    return { valueA: Number(input.toFixed(2)), sourceString: `${input} A` };
  }
  const sourceString = input.trim();
  const { num, unitPart } = parseLeadingNumber(sourceString, "current_a");
  if (unitPart === "" || unitPart === "a" || unitPart === "ა" || unitPart === "ამპერი") {
    return { valueA: Number(num.toFixed(2)), sourceString };
  }
  throw new AppError("VALIDATION_ERROR", `Unsupported current unit in "${sourceString}".`);
}

function processUnitField(
  unitKey: UniversalUnitKey,
  fieldInput: UniversalUnitFieldInput,
  normalizer: (val: string | number) => { numericValue: number; sourceString: string },
  sources: Record<string, string>,
  metadata: Record<string, SkuUnitMetadataEntry>,
  defaultVerifiedByUserId?: string
): string | null {
  if (fieldInput === undefined || fieldInput === null || fieldInput === "") {
    return null;
  }

  if (typeof fieldInput === "object") {
    const { value, status, sourceType, evidenceId, verifiedBy, verifiedAt } = fieldInput;
    if (status === "NOT_FOUND") {
      if (value !== null) {
        throw new AppError(
          "VALIDATION_ERROR",
          `Universal unit "${unitKey}" has status NOT_FOUND and must have value: null (§6.5).`
        );
      }
      metadata[unitKey] = {
        sourceString: null,
        status: "NOT_FOUND",
        ...(sourceType ? { sourceType } : {})
      };
      return null;
    }

    if (value === null || value === "") {
      return null;
    }

    const effectiveVerifiedBy =
      status === "VERIFIED" ? (verifiedBy ?? defaultVerifiedByUserId) : verifiedBy;

    if (status === "VERIFIED" && !evidenceId && !effectiveVerifiedBy) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Universal unit "${unitKey}" cannot be marked VERIFIED without an evidenceId or verifiedBy user ID (§5.6, §5.9).`,
        { field: unitKey }
      );
    }

    const { numericValue, sourceString } = normalizer(value);
    sources[unitKey] = sourceString;
    metadata[unitKey] = {
      sourceString,
      status,
      ...(sourceType ? { sourceType } : {}),
      ...(evidenceId ? { evidenceId } : {}),
      ...(effectiveVerifiedBy ? { verifiedBy: effectiveVerifiedBy } : {}),
      ...(status === "VERIFIED"
        ? { verifiedAt: verifiedAt ?? new Date().toISOString() }
        : {})
    };
    return String(numericValue);
  }

  // Raw string or number defaults to UNVERIFIED so unverified/AI values are never mistaken for VERIFIED
  const { numericValue, sourceString } = normalizer(fieldInput);
  sources[unitKey] = sourceString;
  metadata[unitKey] = {
    sourceString,
    status: "UNVERIFIED"
  };
  return String(numericValue);
}

/**
 * §5.6 Normalizes all universal unit inputs, enforces verification provenance,
 * and builds both `unit_source_strings_json` and `unit_metadata_json`.
 */
export function normalizeUniversalUnits(
  input: UniversalUnitsInput = {},
  existingSources: Record<string, string> = {},
  existingMetadata: Record<string, SkuUnitMetadataEntry> = {},
  options?: { defaultVerifiedByUserId?: string }
): NormalizedUniversalUnits {
  const sources: Record<string, string> = { ...existingSources };
  const metadata: Record<string, SkuUnitMetadataEntry> = { ...existingMetadata };
  const defaultVerifiedBy = options?.defaultVerifiedByUserId;

  const powerKw = processUnitField(
    "power_kw",
    input.power,
    (v) => {
      const r = normalizePowerToKw(v);
      return { numericValue: r.valueKw, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  const engineDisplacementCm3 = processUnitField(
    "engine_displacement_cm3",
    input.engineDisplacement,
    (v) => {
      const r = normalizeDisplacementToCm3(v);
      return { numericValue: r.valueCm3, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  const lengthMm = processUnitField(
    "length_mm",
    input.length,
    (v) => {
      const r = normalizeLengthToMm(v, "length_mm");
      return { numericValue: r.valueMm, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  const widthMm = processUnitField(
    "width_mm",
    input.width,
    (v) => {
      const r = normalizeLengthToMm(v, "width_mm");
      return { numericValue: r.valueMm, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  const heightMm = processUnitField(
    "height_mm",
    input.height,
    (v) => {
      const r = normalizeLengthToMm(v, "height_mm");
      return { numericValue: r.valueMm, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  const workingWidthMm = processUnitField(
    "working_width_mm",
    input.workingWidth,
    (v) => {
      const r = normalizeLengthToMm(v, "working_width_mm");
      return { numericValue: r.valueMm, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  const workingDepthMm = processUnitField(
    "working_depth_mm",
    input.workingDepth,
    (v) => {
      const r = normalizeLengthToMm(v, "working_depth_mm");
      return { numericValue: r.valueMm, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  const weightKg = processUnitField(
    "weight_kg",
    input.weight,
    (v) => {
      const r = normalizeWeightToKg(v);
      return { numericValue: r.valueKg, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  const volumeL = processUnitField(
    "volume_l",
    input.volume,
    (v) => {
      const r = normalizeVolumeToL(v);
      return { numericValue: r.valueL, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  const pressureBar = processUnitField(
    "pressure_bar",
    input.pressure,
    (v) => {
      const r = normalizePressureToBar(v);
      return { numericValue: r.valueBar, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  const flowLMin = processUnitField(
    "flow_l_min",
    input.flow,
    (v) => {
      const r = normalizeFlowToLMin(v);
      return { numericValue: r.valueLMin, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  const voltageV = processUnitField(
    "voltage_v",
    input.voltage,
    (v) => {
      const r = normalizeVoltageToV(v);
      return { numericValue: r.valueV, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  const currentA = processUnitField(
    "current_a",
    input.current,
    (v) => {
      const r = normalizeCurrentToA(v);
      return { numericValue: r.valueA, sourceString: r.sourceString };
    },
    sources,
    metadata,
    defaultVerifiedBy
  );

  return {
    powerKw,
    engineDisplacementCm3,
    lengthMm,
    widthMm,
    heightMm,
    workingWidthMm,
    workingDepthMm,
    weightKg,
    volumeL,
    pressureBar,
    flowLMin,
    voltageV,
    currentA,
    unitSourceStringsJson: sources,
    unitMetadataJson: metadata
  };
}

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

export interface UniversalUnitsInput {
  power?: string | number | null;
  engineDisplacement?: string | number | null;
  length?: string | number | null;
  width?: string | number | null;
  height?: string | number | null;
  workingWidth?: string | number | null;
  workingDepth?: string | number | null;
  weight?: string | number | null;
  volume?: string | number | null;
  pressure?: string | number | null;
  flow?: string | number | null;
  voltage?: string | number | null;
  current?: string | number | null;
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

/**
 * §5.6 Normalizes all universal unit inputs and builds `unit_source_strings_json`.
 */
export function normalizeUniversalUnits(
  input: UniversalUnitsInput = {},
  existingSources: Record<string, string> = {}
): NormalizedUniversalUnits {
  const sources: Record<string, string> = { ...existingSources };

  const power =
    input.power !== undefined && input.power !== null && input.power !== ""
      ? normalizePowerToKw(input.power)
      : null;
  if (power) sources.power_kw = power.sourceString;

  const disp =
    input.engineDisplacement !== undefined &&
    input.engineDisplacement !== null &&
    input.engineDisplacement !== ""
      ? normalizeDisplacementToCm3(input.engineDisplacement)
      : null;
  if (disp) sources.engine_displacement_cm3 = disp.sourceString;

  const length =
    input.length !== undefined && input.length !== null && input.length !== ""
      ? normalizeLengthToMm(input.length, "length_mm")
      : null;
  if (length) sources.length_mm = length.sourceString;

  const width =
    input.width !== undefined && input.width !== null && input.width !== ""
      ? normalizeLengthToMm(input.width, "width_mm")
      : null;
  if (width) sources.width_mm = width.sourceString;

  const height =
    input.height !== undefined && input.height !== null && input.height !== ""
      ? normalizeLengthToMm(input.height, "height_mm")
      : null;
  if (height) sources.height_mm = height.sourceString;

  const workingWidth =
    input.workingWidth !== undefined &&
    input.workingWidth !== null &&
    input.workingWidth !== ""
      ? normalizeLengthToMm(input.workingWidth, "working_width_mm")
      : null;
  if (workingWidth) sources.working_width_mm = workingWidth.sourceString;

  const workingDepth =
    input.workingDepth !== undefined &&
    input.workingDepth !== null &&
    input.workingDepth !== ""
      ? normalizeLengthToMm(input.workingDepth, "working_depth_mm")
      : null;
  if (workingDepth) sources.working_depth_mm = workingDepth.sourceString;

  const weight =
    input.weight !== undefined && input.weight !== null && input.weight !== ""
      ? normalizeWeightToKg(input.weight)
      : null;
  if (weight) sources.weight_kg = weight.sourceString;

  const volume =
    input.volume !== undefined && input.volume !== null && input.volume !== ""
      ? normalizeVolumeToL(input.volume)
      : null;
  if (volume) sources.volume_l = volume.sourceString;

  const pressure =
    input.pressure !== undefined && input.pressure !== null && input.pressure !== ""
      ? normalizePressureToBar(input.pressure)
      : null;
  if (pressure) sources.pressure_bar = pressure.sourceString;

  const flow =
    input.flow !== undefined && input.flow !== null && input.flow !== ""
      ? normalizeFlowToLMin(input.flow)
      : null;
  if (flow) sources.flow_l_min = flow.sourceString;

  const voltage =
    input.voltage !== undefined && input.voltage !== null && input.voltage !== ""
      ? normalizeVoltageToV(input.voltage)
      : null;
  if (voltage) sources.voltage_v = voltage.sourceString;

  const current =
    input.current !== undefined && input.current !== null && input.current !== ""
      ? normalizeCurrentToA(input.current)
      : null;
  if (current) sources.current_a = current.sourceString;

  return {
    powerKw: power ? String(power.valueKw) : null,
    engineDisplacementCm3: disp ? String(disp.valueCm3) : null,
    lengthMm: length ? String(length.valueMm) : null,
    widthMm: width ? String(width.valueMm) : null,
    heightMm: height ? String(height.valueMm) : null,
    workingWidthMm: workingWidth ? String(workingWidth.valueMm) : null,
    workingDepthMm: workingDepth ? String(workingDepth.valueMm) : null,
    weightKg: weight ? String(weight.valueKg) : null,
    volumeL: volume ? String(volume.valueL) : null,
    pressureBar: pressure ? String(pressure.valueBar) : null,
    flowLMin: flow ? String(flow.valueLMin) : null,
    voltageV: voltage ? String(voltage.valueV) : null,
    currentA: current ? String(current.valueA) : null,
    unitSourceStringsJson: sources
  };
}

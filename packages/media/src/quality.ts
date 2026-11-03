/** Shared deterministic Tier-1 checks. No browser, filesystem or image-library dependency. */
export interface QualityConfig {
  minLongEdge: number; blurVariance: number; maxDarkShare: number; maxBrightShare: number; darkClip: number; brightClip: number;
}
export const DEFAULT_QUALITY_CONFIG: QualityConfig = { minLongEdge: 1920, blurVariance: 50, maxDarkShare: .85, maxBrightShare: .90, darkClip: 8, brightClip: 247 };
export type QualityReason = "RESOLUTION" | "UNDEREXPOSED" | "OVEREXPOSED" | "BLUR";
export interface QualityReport extends Record<string, unknown> { passed: boolean; reasons: QualityReason[]; width: number; height: number; variance: number; darkShare: number; brightShare: number }
export function qualityConfig(input: Partial<QualityConfig> = {}): QualityConfig {
  const config = { ...DEFAULT_QUALITY_CONFIG, ...input };
  if (Object.values(config).some((value) => !Number.isFinite(value)) || config.minLongEdge < 1 || config.minLongEdge > 8192
    || config.blurVariance < 0 || config.blurVariance > 100000 || config.maxDarkShare < 0 || config.maxDarkShare > 1
    || config.maxBrightShare < 0 || config.maxBrightShare > 1 || config.darkClip < 0 || config.brightClip > 255
    || config.darkClip >= config.brightClip) throw new Error("Invalid image quality configuration.");
  return config;
}
export function evaluatePhotoQuality(input: { width: number; height: number; gray: Uint8Array; sampleWidth: number; sampleHeight: number }, config = DEFAULT_QUALITY_CONFIG): QualityReport {
  const { width, height, gray, sampleWidth: w, sampleHeight: h } = input;
  if (![width, height, w, h].every((value) => Number.isSafeInteger(value) && value > 0) || gray.length !== w * h) throw new Error("Invalid quality sample.");
  let dark = 0, bright = 0, sum = 0, square = 0, count = 0;
  for (const value of gray) { if (value <= config.darkClip) dark++; if (value >= config.brightClip) bright++; }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    const value = gray[p - 1]! + gray[p + 1]! + gray[p - w]! + gray[p + w]! - 4 * gray[p]!;
    sum += value; square += value * value; count++;
  }
  const variance = count ? Math.max(0, square / count - (sum / count) ** 2) : 0;
  const darkShare = dark / gray.length, brightShare = bright / gray.length;
  const reasons: QualityReason[] = [];
  if (Math.max(width, height) < config.minLongEdge) reasons.push("RESOLUTION");
  if (darkShare > config.maxDarkShare) reasons.push("UNDEREXPOSED");
  if (brightShare > config.maxBrightShare) reasons.push("OVEREXPOSED");
  if (variance < config.blurVariance) reasons.push("BLUR");
  return { passed: reasons.length === 0, reasons, width, height, variance, darkShare, brightShare };
}
export function grayscale(rgba: Uint8ClampedArray): Uint8Array {
  const gray = new Uint8Array(rgba.length / 4);
  for (let p = 0; p < gray.length; p++) gray[p] = Math.round(.2126 * rgba[p * 4]! + .7152 * rgba[p * 4 + 1]! + .0722 * rgba[p * 4 + 2]!);
  return gray;
}

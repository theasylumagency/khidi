export const AI_JOB_NAMES = [
  "identify-product",
  "extract-evidence",
  "ocr-label",
  "normalize-specifications",
  "classify-product",
  "generate-canonical-content",
  "analyze-photo-quality",
  "process-images"
] as const;

export type AiJobName = (typeof AI_JOB_NAMES)[number];

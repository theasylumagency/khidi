export const SCAN_TASK_TYPES = [
  "INTAKE_UNIQUE",
  "PHYSICAL_COUNT",
  "PHOTO_REQUEST",
  "EVIDENCE_REQUEST",
  "PICK"
] as const;

export type ScanTaskType = (typeof SCAN_TASK_TYPES)[number];

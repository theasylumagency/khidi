import { z } from "zod";

export const SCAN_TASK_TYPES = ["INTAKE_UNIQUE", "PHYSICAL_COUNT", "PHOTO_REQUEST", "EVIDENCE_REQUEST", "PICK"] as const;
export type ScanTaskType = (typeof SCAN_TASK_TYPES)[number];
export const RESULT_STATES = ["MATCHED_EXISTING", "NEW_DRAFT", "MANUAL_IDENTIFICATION_REQUIRED"] as const;
export const LABEL_STATUSES = ["NOT_REQUIRED", "TO_PRINT", "PRINTED", "ATTACHED"] as const;
export const uuidV7Schema = z.string().uuid().refine((value) => value[14] === "7", "UUIDv7 required");

export const intakeInputSchema = z.object({
  idempotencyKey: uuidV7Schema,
  userId: z.string().uuid(),
  deviceId: z.string().uuid(),
  scannedAt: z.string().datetime({ offset: true }),
  taskId: z.string().uuid().nullable().default(null),
  sourceMode: z.enum(["TASK", "QUICK_SCAN"]),
  scannedValue: z.string().trim().max(512).default(""),
  isNoBarcode: z.boolean().default(false),
  identifierType: z.enum(["GTIN", "UPC", "MPN", "FACTORY_MODEL", "PLATE_VALUE", "SUPPLIER_CODE", "ACCOUNTING_CODE", "LEGACY_ALIAS"]).optional()
}).strict().superRefine((input, ctx) => {
  if ((input.sourceMode === "TASK") !== (input.taskId !== null)) {
    ctx.addIssue({ code: "custom", message: "TASK requires taskId; QUICK_SCAN forbids it" });
  }
  if (input.isNoBarcode ? input.scannedValue !== "" : input.scannedValue === "") {
    ctx.addIssue({ code: "custom", message: "Provide either a scanned value or no-barcode" });
  }
});
export type IntakeInput = z.infer<typeof intakeInputSchema>;
export interface IntakeResult extends Record<string, unknown> {
  id: string;
  matchedSkuId: string | null;
  resultState: (typeof RESULT_STATES)[number];
  duplicateOfIntakeId: string | null;
  labelStatus: (typeof LABEL_STATUSES)[number];
}

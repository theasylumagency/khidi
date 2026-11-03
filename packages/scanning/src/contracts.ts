import { z } from "zod";
import { discardedPhotoSchema, PHOTO_SLOTS } from "@khidi/media/contracts";

export const SCAN_TASK_TYPES = ["INTAKE_UNIQUE", "PHYSICAL_COUNT", "PHOTO_REQUEST", "EVIDENCE_REQUEST", "PICK"] as const;
export type ScanTaskType = (typeof SCAN_TASK_TYPES)[number];
export const RESULT_STATES = ["MATCHED_EXISTING", "NEW_DRAFT", "MANUAL_IDENTIFICATION_REQUIRED"] as const;
export const LABEL_STATUSES = ["NOT_REQUIRED", "TO_PRINT", "PRINTED", "ATTACHED"] as const;
export const REVIEW_REASONS = ["UNKNOWN_INTERNAL_LABEL", "ARCHIVED_INTERNAL_LABEL", "IDENTIFIER_COLLISION", "TASK_NOT_ACCEPTING", "TASK_NOT_ASSIGNED"] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];
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
  reviewReason: ReviewReason | null;
}

export const createScanTaskSchema = z.object({
  idempotencyKey: uuidV7Schema,
  taskType: z.enum(SCAN_TASK_TYPES), title: z.string().trim().min(1).max(200),
  assigneeUserId: z.string().uuid().nullable().default(null),
  assigneeRole: z.enum(["ADMIN", "OPERATOR", "STOCK_MANAGER", "WAREHOUSE", "ORDER_MANAGER"]).nullable().default(null),
  productTypeId: z.string().uuid().nullable().default(null),
  targetCount: z.number().int().positive().max(2147483647).nullable().default(null),
  photosRequired: z.boolean().default(true), targetSkuId: z.string().uuid().nullable().default(null),
  requestedPhotoSlots: z.array(z.enum(PHOTO_SLOTS)).min(1).max(4).refine((slots) => new Set(slots).size === slots.length, "Duplicate slots.").nullable().default(null),
  photoRequestNote: z.string().trim().min(1).max(4000).nullable().default(null),
  dueDate: z.string().datetime({ offset: true }).nullable().default(null)
}).strict().refine((input) => Number(input.assigneeUserId !== null) + Number(input.assigneeRole !== null) === 1, "Choose one assignee user or role.").superRefine((input, ctx) => {
  if (input.taskType === "PHOTO_REQUEST" && (!input.targetSkuId || !input.requestedPhotoSlots || !input.photoRequestNote || !input.photosRequired)) ctx.addIssue({ code: "custom", message: "Photo requests require SKU, requested slots and a note." });
  if (input.taskType === "INTAKE_UNIQUE" && (input.targetSkuId || input.requestedPhotoSlots || input.photoRequestNote)) ctx.addIssue({ code: "custom", message: "Photo request fields require PHOTO_REQUEST." });
});
export const intakeFiltersSchema = z.object({
  resultState: z.enum(RESULT_STATES).optional(), labelStatus: z.enum(LABEL_STATUSES).optional(),
  needsReview: z.enum(["yes", "no"]).optional(),
  photosMissing: z.enum(["yes", "no"]).optional(),
  taskId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).max(100000).default(1)
}).strict();

export const reviewResolutionSchema = z.object({
  idempotencyKey: uuidV7Schema, intakeId: z.string().uuid(),
  resolution: z.enum(["LINK_EXISTING", "ACCEPT_FOR_TASK", "DISMISS"]),
  skuId: z.string().uuid().optional(), skuCode: z.string().trim().regex(/^KH-\d{6,}$/).optional(), note: z.string().trim().min(1).max(4000),
  reopenTask: z.boolean().default(false), requestReplacementLabel: z.boolean().default(false)
}).strict().refine((input) => input.resolution !== "LINK_EXISTING" || !!input.skuId !== !!input.skuCode, "Choose one existing SKU.");

export const discardInputSchema = z.object({
  idempotencyKey: uuidV7Schema, scanIdempotencyKey: z.string().min(1).max(128),
  userId: z.string().uuid(), deviceId: z.string().max(128),
  scannedValue: z.string().max(4096), scannedAt: z.string().max(128),
  reason: z.string().trim().min(1).max(4000),
  photos: z.array(discardedPhotoSchema).optional(), photoCount: z.number().int().min(0).optional()
}).strict().refine((value) => value.photos === undefined ? value.photoCount === undefined : value.photoCount === value.photos.length, "Photo metadata count mismatch.");
export type DiscardInput = z.infer<typeof discardInputSchema>;

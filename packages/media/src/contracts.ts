import { z } from "zod";
export const PHOTO_SLOTS = ["MAIN", "SECONDARY", "IDENTIFICATION", "EXTRA"] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const uuidV7 = z.string().max(36).uuid().refine((value) => value[14] === "7", "UUIDv7 required");
export const deviceQualitySchema = z.object({ passed: z.boolean(), reasons: z.array(z.enum(["RESOLUTION", "UNDEREXPOSED", "OVEREXPOSED", "BLUR"])).max(4),
  width: z.number().int().positive(), height: z.number().int().positive(), variance: z.number().finite().nonnegative(), darkShare: z.number().min(0).max(1), brightShare: z.number().min(0).max(1) }).strict();
export const photoUploadSchema = z.object({
  idempotencyKey: uuidV7, userId: z.string().max(36).uuid(), deviceId: z.string().max(36).uuid(), capturedAt: z.string().max(128).datetime({ offset: true }),
  slot: z.enum(PHOTO_SLOTS), skuId: z.string().max(36).uuid().nullable().default(null),
  intakeId: z.string().max(36).uuid().nullable().default(null), intakeIdempotencyKey: uuidV7.nullable().default(null),
  photoRequestTaskId: z.string().max(36).uuid().nullable().default(null), deviceQuality: deviceQualitySchema.optional()
}).strict().superRefine((value, ctx) => {
  if (!value.skuId && !value.intakeId && !value.intakeIdempotencyKey && !value.photoRequestTaskId) ctx.addIssue({ code: "custom", message: "A photo target is required." });
  if (value.intakeId && value.intakeIdempotencyKey || value.photoRequestTaskId && (value.intakeId || value.intakeIdempotencyKey)) ctx.addIssue({ code: "custom", message: "Choose one intake or photo request." });
});
export type PhotoUploadInput = z.infer<typeof photoUploadSchema>;
export interface CaptureSlot { slot: PhotoSlot; required: boolean; titleKa?: string; guidanceKa?: string; alreadyCovered?: boolean }
export const GENERIC_CAPTURE_SLOTS: CaptureSlot[] = ["MAIN", "SECONDARY", "IDENTIFICATION"].map((slot) => ({ slot: slot as PhotoSlot, required: true }));
export interface DiscardedPhotoMetadata { idempotencyKey: string; slot: PhotoSlot; sha256: string; bytes: number; capturedAt: string }
export const discardedPhotoSchema = z.object({ idempotencyKey: uuidV7, slot: z.enum(PHOTO_SLOTS), sha256: z.string().max(64).regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(MAX_PHOTO_BYTES), capturedAt: z.string().max(128).datetime({ offset: true }) }).strict();
export const PHOTO_TARGET_FIELDS = {
  intakeId: z.string().max(36).uuid().nullable().default(null), intakeIdempotencyKey: uuidV7.nullable().default(null),
  photoRequestTaskId: z.string().max(36).uuid().nullable().default(null), skuId: z.string().max(36).uuid().nullable().default(null)
};
export const photoTargetSchema = z.object(PHOTO_TARGET_FIELDS).strict().refine((value) => Object.values(value).filter(Boolean).length === 1, "Choose one photo target.");
export type PhotoTarget = z.infer<typeof photoTargetSchema>;
export const photoAttentionSchema = z.object({ ...PHOTO_TARGET_FIELDS,
  idempotencyKey: uuidV7, userId: z.string().max(36).uuid(), deviceId: z.string().max(36).uuid(),
  capturedAt: z.string().max(128).datetime({ offset: true }), reason: z.string().trim().min(1).max(4000),
  slots: z.array(z.enum(PHOTO_SLOTS)).min(1).max(4)
}).strict().refine((value) => [value.intakeId, value.intakeIdempotencyKey, value.photoRequestTaskId, value.skuId].filter(Boolean).length === 1, "Choose one photo target.");
export const photoDiscardSchema = z.object({ ...PHOTO_TARGET_FIELDS, idempotencyKey: uuidV7, userId: z.string().max(36).uuid(), deviceId: z.string().max(36).uuid(), reason: z.string().trim().min(1).max(4000), photo: discardedPhotoSchema }).strict().refine((value) => [value.intakeId, value.intakeIdempotencyKey, value.photoRequestTaskId, value.skuId].filter(Boolean).length === 1, "Choose one photo target.");
export type PhotoAttentionInput = z.infer<typeof photoAttentionSchema>;
export type PhotoDiscardInput = z.infer<typeof photoDiscardSchema>;

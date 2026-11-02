import { z } from "zod";
export const PHOTO_SLOTS = ["MAIN", "SECONDARY", "IDENTIFICATION", "EXTRA"] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const uuidV7 = z.string().uuid().refine((value) => value[14] === "7", "UUIDv7 required");
export const photoUploadSchema = z.object({
  idempotencyKey: uuidV7, userId: z.string().uuid(), deviceId: z.string().uuid(), capturedAt: z.string().datetime({ offset: true }),
  slot: z.enum(PHOTO_SLOTS), skuId: z.string().uuid().nullable().default(null),
  intakeId: z.string().uuid().nullable().default(null), intakeIdempotencyKey: uuidV7.nullable().default(null),
  photoRequestTaskId: z.string().uuid().nullable().default(null)
}).strict().superRefine((value, ctx) => {
  if (!value.skuId && !value.intakeId && !value.intakeIdempotencyKey && !value.photoRequestTaskId) ctx.addIssue({ code: "custom", message: "A photo target is required." });
  if (value.intakeId && value.intakeIdempotencyKey || value.photoRequestTaskId && (value.intakeId || value.intakeIdempotencyKey)) ctx.addIssue({ code: "custom", message: "Choose one intake or photo request." });
});
export type PhotoUploadInput = z.infer<typeof photoUploadSchema>;
export interface CaptureSlot { slot: PhotoSlot; required: boolean; titleKa?: string; guidanceKa?: string }
export const GENERIC_CAPTURE_SLOTS: CaptureSlot[] = ["MAIN", "SECONDARY", "IDENTIFICATION"].map((slot) => ({ slot: slot as PhotoSlot, required: true }));
export interface DiscardedPhotoMetadata { idempotencyKey: string; slot: PhotoSlot; sha256: string; bytes: number; capturedAt: string }

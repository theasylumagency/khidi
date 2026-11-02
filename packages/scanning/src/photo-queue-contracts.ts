import type { PhotoUploadInput, PhotoAttentionInput, PhotoDiscardInput, PhotoSlot } from "@khidi/media/contracts";
export interface QueuedPhoto { idempotencyKey: string; userId: string; userName: string; input: PhotoUploadInput; blob: Blob; sha256: string; bytes: number; attempts: number; nextAttemptAt: number; blocked: boolean; lastCode?: string; lastStatus?: number }
export interface QueuedPhotoReport { idempotencyKey: string; userId: string; userName: string; kind: "attention" | "discard"; input: PhotoAttentionInput | PhotoDiscardInput; attempts: number; nextAttemptAt: number }
export interface IntakeReceipt { idempotencyKey: string; userId: string; intakeId?: string; duplicateOfIntakeId?: string | null }
export interface CachedTaskIdentifier { key: string; intakeId?: string; intakeIdempotencyKey?: string }
export interface LocalPhotoState { slots: PhotoSlot[]; count: number }

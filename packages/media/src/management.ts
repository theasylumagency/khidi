import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, imageMasterVersions, productImages } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError, sha256Hex } from "@khidi/shared";
import { uuidV7 } from "./contracts.ts";
import { assertMediaPrincipal } from "./principal.ts";
import { refreshIntakePhotoStatus } from "./targets.ts";
import { mediaReceipt, queueMediaJob, recordMediaReceipt } from "./transactions.ts";
import { signPrivateMedia } from "./signing.ts";
const actionSchema = z.object({ idempotencyKey: uuidV7, imageId: z.string().uuid(), action: z.enum(["UPDATE", "VERIFY", "REJECT", "REPROCESS"]),
  role: z.enum(["MAIN", "GALLERY", "IDENTITY"]).optional(), usage: z.enum(["PUBLIC", "INTERNAL_EVIDENCE"]).optional(), sortOrder: z.number().int().min(0).max(2147483647).optional(), reason: z.string().trim().min(1).max(4000).optional()
}).strict().superRefine((input, ctx) => {
  if (input.action === "REJECT" && !input.reason) ctx.addIssue({ code: "custom", message: "Rejection reason required." });
  const fields = [input.role, input.usage, input.sortOrder].some((value) => value !== undefined);
  if ((input.action === "UPDATE") !== fields) ctx.addIssue({ code: "custom", message: "Only UPDATE accepts role, usage or order." });
});
export async function listManagedImages(db: DbExecutor, principal: AuthenticatedPrincipal, target: { skuId?: string; intakeId?: string }) {
  await assertMediaPrincipal(db, principal, true);
  if (Number(!!target.skuId) + Number(!!target.intakeId) !== 1 || !z.string().uuid().safeParse(target.skuId ?? target.intakeId).success) throw new AppError("VALIDATION_ERROR", "Choose a SKU or intake.");
  return db.select().from(productImages).where(target.skuId ? eq(productImages.skuId, target.skuId) : eq(productImages.intakeId, target.intakeId!)).orderBy(asc(productImages.sortOrder), asc(productImages.createdAt), asc(productImages.id));
}
export async function hasVerifiedPublicMainImage(db: DbExecutor, skuId: string) {
  const rows = await db.select({ id: productImages.id }).from(productImages).where(and(eq(productImages.skuId, skuId), eq(productImages.status, "VERIFIED"), eq(productImages.usage, "PUBLIC"), eq(productImages.role, "MAIN"))).limit(1);
  return rows.length > 0;
}
export async function listMediaImageViews(db: DbExecutor, principal: AuthenticatedPrincipal, target: { skuId?: string; intakeId?: string }) {
  const images = await listManagedImages(db, principal, target);
  const versions = images.length ? await db.select().from(imageMasterVersions).where(inArray(imageMasterVersions.imageId, images.map((image) => image.id))).orderBy(asc(imageMasterVersions.version)) : [];
  return images.map((image) => ({ id: image.id, skuId: image.skuId, slot: image.slot, role: image.role, usage: image.usage, status: image.status, rejectReason: image.rejectReason, sortOrder: image.sortOrder,
    width: image.width, height: image.height, rawBytes: image.rawBytes, rawSha256: image.rawSha256, tier1: image.tier1QualityJson, tier2: image.tier2QualityJson, processingStatus: image.processingStatus,
    masterVersion: image.masterVersion, updatedAt: image.updatedAt.toISOString(),
    rawUrl: signPrivateMedia(principal.userId, image.id, "raw", 0), previewUrl: signPrivateMedia(principal.userId, image.id, image.masterVersion ? "400.webp" : "raw", image.masterVersion || 0),
    versions: versions.filter((version) => version.imageId === image.id).map((version) => ({ version: version.version, masterUrl: signPrivateMedia(principal.userId, image.id, "master", version.version),
      derivatives: Object.entries(version.derivativesJson).map(([variant, derivative]) => ({ variant, width: derivative.width, format: derivative.format, url: signPrivateMedia(principal.userId, image.id, variant, version.version) })) })) }));
}
export type ManagedImageView = Awaited<ReturnType<typeof listMediaImageViews>>[number];
export async function manageImage(db: DbExecutor, principal: AuthenticatedPrincipal, raw: unknown) {
  await assertMediaPrincipal(db, principal, true);
  const parsed = actionSchema.safeParse(raw); if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid image action.");
  const input = parsed.data, hash = sha256Hex(JSON.stringify(input));
  return executeIdempotent(db, { scope: "media:manage", idempotencyKey: input.idempotencyKey, payload: { ...input, userId: principal.userId } }, (tx) => withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
    const receipt = await mediaReceipt(ctx.tx, input.idempotencyKey, principal.userId, hash, "MANAGE_IMAGE"); if (receipt) return { status: 200, body: receipt };
    const [image] = await ctx.tx.select().from(productImages).where(eq(productImages.id, input.imageId)).for("update");
    if (!image) throw new AppError("NOT_FOUND", "Image not found.");
    const changes: Partial<typeof productImages.$inferInsert> = { updatedAt: new Date() };
    if (input.action === "UPDATE") { if (input.role) changes.role = input.role; if (input.usage) changes.usage = input.usage; if (input.sortOrder !== undefined) changes.sortOrder = input.sortOrder; }
    if (input.action === "VERIFY") {
      if (!image.masterVersion || image.processingStatus !== "COMPLETED" || image.tier1QualityJson.passed !== true) throw new AppError("PRECONDITION_FAILED", "A processed Tier-1-passing image is required.");
      Object.assign(changes, { status: "VERIFIED", verifiedBy: principal.userId, verifiedAt: new Date(), rejectReason: null });
    }
    if (input.action === "REJECT") Object.assign(changes, { status: "REJECTED", rejectReason: input.reason!, verifiedBy: null, verifiedAt: null });
    if (input.action === "REPROCESS") {
      changes.requestedVersion = image.requestedVersion + 1; changes.processingStatus = "PENDING";
      await queueMediaJob(ctx, "process-image", { imageId: image.id, imageVersion: changes.requestedVersion }, `process-image:${image.id}:${changes.requestedVersion}`);
    }
    await ctx.tx.update(productImages).set(changes).where(eq(productImages.id, image.id));
    if (image.intakeId && ["VERIFY", "REJECT"].includes(input.action)) await refreshIntakePhotoStatus(ctx, image.intakeId);
    if (image.skuId) await queueMediaJob(ctx, "publish-sku-media", { skuId: image.skuId });
    const body = { id: image.id, status: changes.status ?? image.status, requestedVersion: changes.requestedVersion ?? image.requestedVersion };
    await ctx.recordAudit({ action: input.action === "REPROCESS" ? "IMAGE_REPROCESSED" : "IMAGE_UPDATED", entityType: "product_image", entityId: image.id,
      before: { status: image.status, role: image.role, usage: image.usage, sortOrder: image.sortOrder, requestedVersion: image.requestedVersion }, after: { ...changes, action: input.action }, reason: input.reason });
    await ctx.emitOutboxEvent({ eventType: input.action === "REPROCESS" ? "IMAGE_REPROCESSED" : "IMAGE_UPDATED", aggregateType: "product_image", aggregateId: image.id, payload: body, consumers: [] });
    await recordMediaReceipt(ctx, input.idempotencyKey, hash, "MANAGE_IMAGE", body); return { status: 200, body };
  }));
}

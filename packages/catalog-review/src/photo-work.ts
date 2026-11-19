import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { catalogReviewPhotoWork as work, catalogReviewPhotoLinks as links, catalogReviewPhotos as photos,
  type AppDatabase, type DbExecutor } from "@khidi/db";
import { executeIdempotent, withDomainTransaction, type DomainTransactionContext } from "@khidi/domain";
import { renderReviewComposition, storeLegacyReviewPhoto, suggestReviewPlacement } from "@khidi/media";
import { digest, type MediaStorage } from "@khidi/media/storage";
import { AppError, createUuidV7 } from "@khidi/shared";
import { lockPilotPhotoWork, requireReviewProduct } from "./access.ts";

const uid = z.string().uuid();
export const photoForm = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UPLOAD"), productId: uid }).strict(),
  z.object({ kind: z.literal("REQUEST"), productId: uid, basePhotoId: uid,
    mode: z.enum(["INSET","MOUNT"]), detail: z.string().trim().min(1).max(240) }).strict()
]);
export const renderInput = z.object({ productId: uid, requestId: uid,
  placement: z.object({ x: z.number().int().min(0).max(100), y: z.number().int().min(0).max(100),
    size: z.number().int().min(10).max(70) }).strict(),
  model: z.enum(["local","gemini-3.1-flash-image","gemini-3-pro-image"]) }).strict();
export const acceptInput = z.object({ productId: uid, previewId: uid }).strict();

async function append(ctx: DomainTransactionContext, data: typeof work.$inferInsert) {
  await ctx.tx.insert(work).values(data);
  const eventType = "CATALOG_REVIEW_PHOTO_WORK";
  const payload = { productId: data.productId, kind: data.kind, parentId: data.parentId ?? null, photoId: data.photoId ?? null };
  await ctx.recordAudit({ action: eventType, entityType: "catalog_review_photo_work", entityId: data.id, after: payload });
  await ctx.emitOutboxEvent({ eventType, aggregateType: "catalog_review_product", aggregateId: data.productId, payload, consumers: [] });
}

async function addToGallery(tx: DbExecutor, batchId: string, productId: string, photoId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"photo-gallery:" + productId},0))`);
  await tx.insert(links).values({ batchId, productId, photoId,
    position: sql`(SELECT coalesce(max(position),0)+1 FROM catalog_review_photo_links WHERE product_id=${productId})` });
}

async function saveAsset(tx: DbExecutor, storage: MediaStorage, batchId: string, bytes: Uint8Array,
  origin: "UPLOAD" | "REFERENCE" | "COMPOSITION") {
  const id = createUuidV7();
  const saved = await storeLegacyReviewPhoto(storage, id, bytes);
  await tx.insert(photos).values({ id, batchId, assetKey: "review-" + id, sourceUrl: "review:" + id, audit: { origin },
    rawKey: saved.raw.key, rawSha256: saved.raw.sha256, rawVersion: saved.raw.versionId,
    previewKey: saved.preview.key, previewSha256: saved.preview.sha256, previewVersion: saved.preview.versionId });
  return id;
}

async function readAsset(tx: DbExecutor, storage: MediaStorage, batchId: string, id: string) {
  const [row] = await tx.select().from(photos).where(and(eq(photos.batchId,batchId),eq(photos.id,id)));
  if (!row) throw new AppError("NOT_FOUND", "Unknown review image.");
  return storage.readPrivate(row.rawKey, row.rawSha256, row.rawVersion ?? undefined);
}

async function event(tx: DbExecutor, productId: string, id: string, kind: typeof work.$inferSelect.kind) {
  const [row] = await tx.select().from(work).where(and(eq(work.productId,productId),eq(work.id,id),eq(work.kind,kind)));
  if (!row) throw new AppError("NOT_FOUND","Unknown review photo operation.");
  return row;
}

export async function uploadReviewImage(db: AppDatabase, storage: MediaStorage, principal: AuthenticatedPrincipal,
  key: string, form: z.infer<typeof photoForm>, bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new AppError("VALIDATION_ERROR","Invalid image size.");
  await requireReviewProduct(db, principal, form.productId);
  return executeIdempotent(db, { scope: "review-upload:" + principal.userId, idempotencyKey: key, payload: { ...form, sha: digest(bytes) } },
    tx => withDomainTransaction(tx, { userId: principal.userId }, async ctx => {
      const { id: productId, batchId } = await requireReviewProduct(ctx.tx, principal, form.productId);
      await lockPilotPhotoWork(ctx.tx, principal, productId);
      let placement;
      if (form.kind === "REQUEST") {
        const [base] = await ctx.tx.select().from(links).where(and(eq(links.productId,productId), eq(links.photoId,form.basePhotoId)));
        if (!base) throw new AppError("VALIDATION_ERROR","Select a gallery image from this product.");
        placement = await suggestReviewPlacement(await readAsset(ctx.tx, storage, batchId, base.photoId), form.mode);
      }
      const photoId = await saveAsset(ctx.tx, storage, batchId, bytes, form.kind === "UPLOAD" ? "UPLOAD" : "REFERENCE");
      const id = createUuidV7();
      await append(ctx, { ...form, id, batchId, photoId, placement, actorId: principal.userId });
      if (form.kind === "UPLOAD") await addToGallery(ctx.tx, batchId, productId, photoId);
      return { status: 201, body: { id, photoId } };
    }));
}

export async function renderReviewDraft(db: AppDatabase, storage: MediaStorage, principal: AuthenticatedPrincipal,
  key: string, input: z.infer<typeof renderInput>) {
  const product = await requireReviewProduct(db, principal, input.productId);
  const request = await event(db, product.id, input.requestId, "REQUEST");
  if (input.model !== "local" && (request.mode !== "MOUNT" || !process.env.REVIEW_GEMINI_API_KEY)) {
    throw new AppError("VALIDATION_ERROR","AI mounting is unavailable.");
  }
  // Commit the attempt before calling the provider. An uncertain or interrupted call may already have been billed.
  const attempt = await executeIdempotent(db, { scope: "review-render:" + principal.userId, idempotencyKey: key, payload: input },
    tx => withDomainTransaction(tx, { userId: principal.userId }, async ctx => {
      await requireReviewProduct(ctx.tx, principal, product.id);
      await lockPilotPhotoWork(ctx.tx, principal, product.id);
      await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${request.id},0))`);
      const [accepted] = await ctx.tx.select({ id: work.id }).from(work).where(and(eq(work.parentId,request.id),eq(work.kind,"ACCEPT")));
      if (accepted) throw new AppError("CONFLICT","A version of this request is already accepted.");
      if (input.model !== "local") {
        await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('review-photo-paid-pilot',0))`);
        const [used] = await ctx.tx.select({ count: sql<number>`count(*)::int` }).from(work)
          .where(and(eq(work.kind,"RENDER"), sql`${work.model} <> 'local'`));
        if (used!.count >= 40) throw new AppError("PRECONDITION_FAILED","Pilot image allowance exhausted.");
      }
      const id = createUuidV7();
      await append(ctx, { id, kind: "RENDER", productId: product.id, batchId: product.batchId, actorId: principal.userId,
        parentId: request.id, placement: input.placement, model: input.model });
      return { status: 200, body: { id } };
    }));
  const attemptId = attempt.body.id;
  if (attempt.replayed) {
    const [result] = await db.select().from(work).where(eq(work.parentId, attemptId));
    if (result?.kind === "PREVIEW") return { status: 200, body: { id: result.id } };
    if (result?.kind === "FAILED") throw new AppError("PRECONDITION_FAILED","Render failed.", { photoStatus: "failed" });
    throw new AppError("CONFLICT","Render already submitted. Check product history.");
  }
  let rendered: Uint8Array;
  try {
    const [base, source] = await Promise.all([readAsset(db, storage, product.batchId, request.basePhotoId!),
      readAsset(db, storage, product.batchId, request.photoId!)]);
    rendered = await renderReviewComposition(base, source, request.detail!, request.mode!, input.placement, input.model);
  } catch {
    await withDomainTransaction(db, { userId: principal.userId }, ctx => append(ctx, {
      id: createUuidV7(), productId: product.id, batchId: product.batchId, actorId: principal.userId,
      kind: "FAILED", parentId: attemptId }));
    throw new AppError("PRECONDITION_FAILED","Render failed.", { photoStatus: "failed" });
  }
  return withDomainTransaction(db, { userId: principal.userId }, async ctx => {
    const photoId = await saveAsset(ctx.tx, storage, product.batchId, rendered, "COMPOSITION");
    const id = createUuidV7();
    await append(ctx, { id, productId: product.id, batchId: product.batchId, actorId: principal.userId,
      kind: "PREVIEW", parentId: attemptId, photoId });
    return { status: 201, body: { id } };
  });
}

export async function acceptReviewDraft(db: AppDatabase, principal: AuthenticatedPrincipal, key: string, input: z.infer<typeof acceptInput>) {
  await requireReviewProduct(db, principal, input.productId);
  return executeIdempotent(db, { scope: "review-accept:" + principal.userId, idempotencyKey: key, payload: input },
    tx => withDomainTransaction(tx, { userId: principal.userId }, async ctx => {
      const { id: productId, batchId } = await requireReviewProduct(ctx.tx, principal, input.productId);
      await lockPilotPhotoWork(ctx.tx, principal, productId);
      const preview = await event(ctx.tx, productId, input.previewId, "PREVIEW");
      const render = await event(ctx.tx, productId, preview.parentId!, "RENDER");
      const requestId = render.parentId!;
      await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${requestId},0))`);
      const [accepted] = await ctx.tx.select().from(work).where(and(eq(work.parentId, requestId), eq(work.kind,"ACCEPT")));
      if (accepted && accepted.photoId !== preview.photoId) throw new AppError("CONFLICT","A different version has been accepted.");
      if (!accepted) {
        await addToGallery(ctx.tx, batchId, productId, preview.photoId!);
        await append(ctx, { id: createUuidV7(), kind: "ACCEPT", actorId: principal.userId, batchId, productId,
          parentId: requestId, photoId: preview.photoId });
      }
      return { status: 200, body: { id: preview.id } };
    }));
}

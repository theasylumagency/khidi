import { and, desc, eq } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { getPostgresError,type DbExecutor, mediaJobs, productImages } from "@khidi/db";
import { executeIdempotent, withDomainTransaction, type DomainTransactionContext } from "@khidi/domain";
import { AppError, sha256Hex } from "@khidi/shared";
import { z } from "zod";
import { uuidV7 } from "./contracts.ts";
import { assertMediaPrincipal } from "./principal.ts";
import { processImage, tier2ImageCheck } from "./processing.ts";
import type { MediaStorage } from "./storage.ts";
import { mediaReceipt, recordMediaReceipt } from "./transactions.ts";
import { synchronizePublicMedia } from "./public-media.ts";

async function auditJob(ctx: DomainTransactionContext, id: string, status: string, attempts: number) {
  const [job]=await ctx.tx.select({generation:mediaJobs.generation}).from(mediaJobs).where(eq(mediaJobs.id,id));
  await ctx.recordAudit({ action: "MEDIA_JOB_UPDATED", entityType: "media_job", entityId: id, after: { status, attempts } });
  await ctx.emitOutboxEvent({ eventType: "MEDIA_JOB_UPDATED", aggregateType: "media_job", aggregateId: id, payload: { status, attempts,generation:job?.generation }, consumers: ["DEAD_LETTER","COMPLETED"].includes(status)?["notifications"]:[] });
}
export interface MediaJobHandlers { publish?: (db: DbExecutor, storage: MediaStorage, skuId: string) => Promise<void> }
/** pg-boss owns execution leases; media_jobs retains the human-visible result permanently. */
export async function executeMediaJob(db: DbExecutor, storage: MediaStorage, id: string, handlers: MediaJobHandlers = { publish: synchronizePublicMedia }, generation?: number) {
  const job = await withDomainTransaction(db, {}, async (ctx) => {
    const [job] = await ctx.tx.select().from(mediaJobs).where(eq(mediaJobs.id, id)).for("update");
    if (!job) throw new AppError("NOT_FOUND", "Media job not found.");
    if (generation !== undefined && job.generation !== generation) return null;
    if (job.status === "COMPLETED") return null;
    if (job.status === "DEAD_LETTER") return job;
    if (job.attempts >= job.maxAttempts) {
      await ctx.tx.update(mediaJobs).set({ status: "DEAD_LETTER", updatedAt: new Date() }).where(eq(mediaJobs.id, id));
      if (job.imageId && job.jobType === "process-image") await ctx.tx.update(productImages).set({ processingStatus: "DEAD_LETTER", updatedAt: new Date() }).where(and(eq(productImages.id, job.imageId), eq(productImages.requestedVersion, job.imageVersion!)));
      await auditJob(ctx, id, "DEAD_LETTER", job.attempts); return { ...job, status: "DEAD_LETTER" };
    }
    const attempts = job.attempts + 1;
    await ctx.tx.update(mediaJobs).set({ status: "PROCESSING", attempts, updatedAt: new Date() }).where(eq(mediaJobs.id, id));
    if (job.imageId && job.jobType === "process-image") await ctx.tx.update(productImages).set({ processingStatus: "PROCESSING", updatedAt: new Date() }).where(and(eq(productImages.id, job.imageId), eq(productImages.requestedVersion, job.imageVersion!)));
    await auditJob(ctx, id, "PROCESSING", attempts); return { ...job, attempts };
  });
  if (!job) return;
  if (job.status === "DEAD_LETTER") return { deadLetter: true };
  try {
    if (job.jobType === "publish-sku-media") {
      if (!handlers.publish) throw new Error("Publication handler unavailable.");
      // Publication intents must commit before object writes, outside the completion TX.
      await handlers.publish(db, storage, job.skuId!);
    }
    await withDomainTransaction(db, {}, async (ctx) => {
      const [current] = await ctx.tx.select().from(mediaJobs).where(eq(mediaJobs.id, id)).for("update");
      if (!current || current.status === "COMPLETED" || current.attempts !== job.attempts || current.generation !== job.generation) return;
      // All image DB effects, the version and follow-up jobs commit together.
      if (job.jobType === "process-image") await processImage(ctx, storage, job.imageId!, job.imageVersion!);
      else if (job.jobType === "tier2-image-check") await tier2ImageCheck(ctx, storage, job.imageId!, job.imageVersion!);
      else if (job.jobType !== "publish-sku-media") throw new Error("Media job handler is unavailable.");
      await ctx.tx.update(mediaJobs).set({ status: "COMPLETED", lastError: null, updatedAt: new Date() }).where(eq(mediaJobs.id, id));
      await auditJob(ctx, id, "COMPLETED", job.attempts);
    });
  } catch (error) {
    const dead = job.attempts >= job.maxAttempts;
    await withDomainTransaction(db, {}, async (ctx) => {
      const [current] = await ctx.tx.select().from(mediaJobs).where(eq(mediaJobs.id, id)).for("update");
      if (!current || current.status === "COMPLETED" || current.attempts !== job.attempts || current.generation !== job.generation) return;
      const status = dead ? "DEAD_LETTER" : "RETRY";
      const databaseError=getPostgresError(error);
      const description=databaseError?`DATABASE_ERROR:${databaseError.code}`:error instanceof AppError?error.code:"IMAGE_PROCESSING_FAILED";
      await ctx.tx.update(mediaJobs).set({ status, lastError: description, nextAttemptAt: new Date(Date.now() + 1000 * 2 ** (job.attempts - 1)), updatedAt: new Date() }).where(eq(mediaJobs.id, id));
      if (job.imageId && job.jobType === "process-image") await ctx.tx.update(productImages).set({ processingStatus: status, updatedAt: new Date() }).where(and(eq(productImages.id, job.imageId), eq(productImages.requestedVersion, job.imageVersion!)));
      await auditJob(ctx, id, status, job.attempts);
    });
    if (!dead) {if(getPostgresError(error))throw new Error("Khidi media database operation failed; retry scheduled.");throw error;}
    // The final failure is returned to pg-boss as deadletter by its worker handler.
    return { deadLetter: true };
  }
}
export async function markMediaJobDeadLetter(db: DbExecutor, id: string, generation: number) {
  await withDomainTransaction(db, {}, async (ctx) => {
    const [job] = await ctx.tx.select().from(mediaJobs).where(eq(mediaJobs.id, id)).for("update");
    if (!job || job.generation !== generation || ["COMPLETED", "DEAD_LETTER"].includes(job.status)) return;
    await ctx.tx.update(mediaJobs).set({ status: "DEAD_LETTER", lastError: job.lastError ?? "Queue execution attempts exhausted.", updatedAt: new Date() }).where(eq(mediaJobs.id, id));
    if (job.imageId && job.jobType === "process-image") await ctx.tx.update(productImages).set({ processingStatus: "DEAD_LETTER", updatedAt: new Date() }).where(and(eq(productImages.id, job.imageId), eq(productImages.requestedVersion, job.imageVersion!)));
    await auditJob(ctx, id, "DEAD_LETTER", job.attempts);
  });
}
export async function listMediaJobs(db: DbExecutor, principal: AuthenticatedPrincipal, page = 1) {
  await assertMediaPrincipal(db, principal, true);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new AppError("VALIDATION_ERROR", "Invalid page.");
  const rows = await db.select().from(mediaJobs).orderBy(desc(mediaJobs.createdAt), desc(mediaJobs.id)).limit(101).offset((page - 1) * 100);
  return { rows: rows.slice(0, 100), hasMore: rows.length > 100 };
}
export async function retryMediaJob(db: DbExecutor, principal: AuthenticatedPrincipal, raw: unknown) {
  await assertMediaPrincipal(db, principal, true);
  const parsed = z.object({ idempotencyKey: uuidV7, jobId: z.string().max(36).uuid() }).strict().safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid media retry.");
  const input = parsed.data, hash = sha256Hex(JSON.stringify(input));
  return executeIdempotent(db, { scope: "media:retry", idempotencyKey: input.idempotencyKey, payload: { ...input, userId: principal.userId } }, (tx) => withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
    const receipt = await mediaReceipt(ctx.tx, input.idempotencyKey, principal.userId, hash, "MEDIA_JOB_RETRY");
    if (receipt) return { status: 200, body: receipt };
    const [job] = await ctx.tx.select().from(mediaJobs).where(eq(mediaJobs.id, input.jobId)).for("update");
    if (!job) throw new AppError("NOT_FOUND", "Media job not found.");
    if (job.status !== "DEAD_LETTER") throw new AppError("PRECONDITION_FAILED", "Only a terminal failed job may be retried.");
    await ctx.tx.update(mediaJobs).set({ status: "PENDING", generation: job.generation + 1, attempts: 0, lastError: null, nextAttemptAt: new Date(), updatedAt: new Date() }).where(eq(mediaJobs.id, job.id));
    if (job.imageId && job.jobType === "process-image") await ctx.tx.update(productImages).set({ processingStatus: "PENDING", updatedAt: new Date() }).where(and(eq(productImages.id, job.imageId), eq(productImages.requestedVersion, job.imageVersion!)));
    await auditJob(ctx, job.id, "PENDING", 0);
    await ctx.emitOutboxEvent({ eventType: "MEDIA_JOB_REQUESTED", aggregateType: "media_job", aggregateId: job.id, payload: { jobId: job.id, jobType: job.jobType, generation: job.generation + 1 }, consumers: ["media-jobs"] });
    const body = { id: job.id }; await recordMediaReceipt(ctx, input.idempotencyKey, hash, "MEDIA_JOB_RETRY", body); return { status: 200, body };
  }));
}

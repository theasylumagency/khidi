import { and, eq } from "drizzle-orm";
import { type DbExecutor, mediaActions, mediaJobs } from "@khidi/db";
import type { DomainTransactionContext } from "@khidi/domain";
import { AppError, createUuidV7 } from "@khidi/shared";
export async function mediaReceipt(tx: DbExecutor, id: string, actorUserId: string, requestHash: string, action: string) {
  const [receipt] = await tx.select().from(mediaActions).where(eq(mediaActions.id, id)).limit(1);
  if (receipt && (receipt.actorUserId !== actorUserId || receipt.requestHash !== requestHash || receipt.action !== action)) throw new AppError("IDEMPOTENCY_CONFLICT", "Media action key already used.");
  return receipt?.responseJson;
}
export async function recordMediaReceipt(ctx: DomainTransactionContext, id: string, requestHash: string, action: string, body: Record<string, unknown>) {
  await ctx.tx.insert(mediaActions).values({ id, actorUserId: ctx.actor.userId!, requestHash, action, responseJson: body });
}
export async function queueMediaJob(ctx: DomainTransactionContext, jobType: "process-image" | "tier2-image-check" | "publish-sku-media", target: { imageId?: string; skuId?: string; imageVersion?: number }, dedupeKey?: string) {
  const key = dedupeKey ?? `${jobType}:${createUuidV7()}`;
  const [existing] = await ctx.tx.select({ id: mediaJobs.id }).from(mediaJobs).where(and(eq(mediaJobs.dedupeKey, key))).limit(1);
  if (existing) return existing.id;
  const id = createUuidV7();
  await ctx.tx.insert(mediaJobs).values({ id, jobType, ...target, dedupeKey: key });
  await ctx.emitOutboxEvent({ eventType: "MEDIA_JOB_REQUESTED", aggregateType: "media_job", aggregateId: id, payload: { jobId: id, jobType, generation: 0 }, consumers: ["media-jobs"] });
  return id;
}

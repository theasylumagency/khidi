import { and, eq, inArray, sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss } from "pg-boss";
import { evidence, outboxDeliveries, outboxEvents, productImages, type DbExecutor } from "@khidi/db";
import { withDomainTransaction, type DomainTransactionContext } from "@khidi/domain";
import type { MediaStorage } from "@khidi/media/storage";
import { AI_JOB_NAMES } from "./job-names.ts";
import { executeAiJob, markAiJobDeadLetter, queueAiJob } from "./jobs.ts";
import { aiDailyCap, type AiProvider } from "./provider.ts";

function pending(ctx: DomainTransactionContext, consumer: string) {
  return ctx.tx.select({ id: outboxDeliveries.id, aggregateId: outboxEvents.aggregateId, payload: outboxEvents.payloadJson })
    .from(outboxDeliveries).innerJoin(outboxEvents, eq(outboxEvents.id, outboxDeliveries.outboxEventId))
    .where(and(eq(outboxDeliveries.consumer, consumer), eq(outboxDeliveries.status, "PENDING")))
    .limit(50).for("update", { skipLocked: true, of: outboxDeliveries });
}
async function dispatched(ctx: DomainTransactionContext, id: string) {
  await ctx.tx.update(outboxDeliveries).set({ status: "DELIVERED", deliveredAt: new Date(), attempts: 1 }).where(eq(outboxDeliveries.id, id));
  await ctx.recordAudit({ action: "AI_JOB_EVENT_DISPATCHED", entityType: "outbox_delivery", entityId: id, after: { delivered: true } });
  await ctx.emitOutboxEvent({ eventType: "AI_JOB_UPDATED", aggregateType: "outbox_delivery", aggregateId: id, payload: { delivered: true }, consumers: [] });
}

export async function dispatchAiJobs(db: DbExecutor, boss: PgBoss) {
  await withDomainTransaction(db, {}, async (ctx) => {
    for (const event of await pending(ctx, "ai-discovery")) {
      const evidenceId = typeof event.payload.evidenceId === "string" ? event.payload.evidenceId : null;
      const [item] = evidenceId ? await ctx.tx.select().from(evidence).where(eq(evidence.id, evidenceId)) : [];
      const imageIds = [item?.imageId ?? event.payload.imageId, ...Array.isArray(event.payload.imageIds) ? event.payload.imageIds : []]
        .filter((id): id is string => typeof id === "string");
      const images = imageIds.length ? await ctx.tx.select().from(productImages).where(inArray(productImages.id, imageIds)) : [];
      for (const image of images) {
        if (!image.skuId || !image.masterVersion || image.status === "REJECTED") continue;
        const sources = await ctx.tx.select().from(evidence).where(eq(evidence.imageId, image.id));
        if (sources.some((source) => source.sensitivity === "INTERNAL_ONLY")) continue;
        const target = { skuId: image.skuId, imageId: image.id, imageVersion: image.masterVersion };
        await queueAiJob(ctx, { ...target, jobName: "analyze-photo-quality" });
        if (image.slot === "IDENTIFICATION") await queueAiJob(ctx, { ...target, jobName: "identify-product" });
        for (const source of sources.filter((candidate) => candidate.status === "PENDING" && candidate.sensitivity === "AI_ALLOWED")) {
          if (["PACKAGING_PHOTO", "PRODUCT_PLATE_PHOTO", "PRODUCT_MARKING_PHOTO"].includes(source.type)) {
            await queueAiJob(ctx, { ...target, evidenceId: source.id, jobName: "ocr-label" });
          }
          await queueAiJob(ctx, { ...target, evidenceId: source.id, jobName: "extract-evidence" });
        }
      }
      await dispatched(ctx, event.id);
    }
    for (const event of await pending(ctx, "ai-jobs")) {
      const { jobId, jobName, generation } = event.payload;
      if (typeof jobId !== "string" || typeof jobName !== "string" || typeof generation !== "number"
        || !AI_JOB_NAMES.some((name) => name === jobName)) throw new Error("Invalid AI job event.");
      await boss.send(jobName, { jobId, generation }, { id: event.id, db: fromDrizzle(ctx.tx, sql) });
      await dispatched(ctx, event.id);
    }
  });
}

export async function startAiWorkers(db: DbExecutor, storage: MediaStorage, boss: PgBoss, provider: AiProvider | null) {
  const cap = aiDailyCap();
  await boss.work<{ jobId: string; generation: number }>("ai-dead-letter", { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await markAiJobDeadLetter(db, job.data.jobId, job.data.generation);
  });
  for (const queue of AI_JOB_NAMES) await boss.work<{ jobId: string; generation: number }>(queue, { batchSize: 1, perJobResults: true }, async (jobs) => {
    const results = [];
    for (const { id, data } of jobs) {
      try { await executeAiJob(db, storage, provider, data.jobId, data.generation, cap); results.push({ id, status: "completed" as const }); }
      catch { results.push({ id, status: "failed" as const }); }
    }
    return results;
  });
}

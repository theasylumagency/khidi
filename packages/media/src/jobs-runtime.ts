import { PgBoss, fromDrizzle } from "pg-boss";
import { and, eq, sql } from "drizzle-orm";
import { type DbExecutor, createMigratorPool, outboxDeliveries, outboxEvents, resolveAppDatabaseUrl, resolveMigratorDatabaseUrl } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { executeMediaJob, markMediaJobDeadLetter, type MediaJobHandlers } from "./jobs.ts";
import type { MediaStorage } from "./storage.ts";
import { synchronizePublicMedia } from "./public-media.ts";
export const MEDIA_QUEUES = ["process-image", "tier2-image-check", "publish-sku-media"] as const;
export const MEDIA_JOB_SCHEMA = "khidi_jobs";
export async function deployMediaJobs(aiQueues: readonly string[] = [], reservationQueues: readonly string[] = [], reportSchedule?:{queue:string;deadLetter:string;cron:string}) {
  const pool = createMigratorPool();
  const boss = new PgBoss({ connectionString: resolveMigratorDatabaseUrl(), schema: MEDIA_JOB_SCHEMA, schedule: false, supervise: false });
  boss.on("error", () => {});
  try {
    const user = await pool.query("SELECT current_user AS name");
    if (user.rows[0]?.name !== "hub_migrator") throw new Error("Job deployment requires hub_migrator.");
    await boss.start();
    await boss.createQueue("media-dead-letter", { retryLimit: 0, retentionSeconds: 2592000 });
    for (const queue of MEDIA_QUEUES) await boss.createQueue(queue, { retryLimit: 2, retryDelay: 1, retryBackoff: true, expireInSeconds: 300, retentionSeconds: 2592000, deadLetter: "media-dead-letter" });
    if (aiQueues.length) {
      await boss.createQueue("ai-dead-letter", { retryLimit: 0, retentionSeconds: 2592000 });
      for (const queue of aiQueues) await boss.createQueue(queue, { retryLimit: 2, retryDelay: 10, retryBackoff: true,
        expireInSeconds: 300, retentionSeconds: 2592000, deadLetter: "ai-dead-letter" });
    }
    if(reservationQueues.length) {
      await boss.createQueue("reservation-dead-letter",{retryLimit:0,retentionSeconds:2592000});
      for(const queue of reservationQueues) await boss.createQueue(queue,{retryLimit:5,retryDelay:10,retryBackoff:true,
        expireInSeconds:300,retentionSeconds:2592000,deadLetter:"reservation-dead-letter"});
    }
    if(reportSchedule) {
      await boss.createQueue(reportSchedule.deadLetter,{retryLimit:0,retentionSeconds:2592000});
      await boss.createQueue(reportSchedule.queue,{retryLimit:3,retryDelay:60,retryBackoff:true,expireInSeconds:3600,retentionSeconds:2592000,deadLetter:reportSchedule.deadLetter});
      await boss.schedule(reportSchedule.queue,reportSchedule.cron,{}, {tz:"Asia/Tbilisi"});
    }
    await pool.query(`REVOKE ALL ON SCHEMA khidi_jobs FROM PUBLIC; REVOKE CREATE ON SCHEMA khidi_jobs FROM hub_app;
      GRANT USAGE ON SCHEMA khidi_jobs TO hub_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA khidi_jobs TO hub_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA khidi_jobs TO hub_app;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA khidi_jobs TO hub_app;`);
  } finally { await boss.stop({ graceful: true }); await pool.end(); }
}
export async function createMediaJobRuntime(options:{schedule?:boolean}={}) {
  const boss = new PgBoss({ connectionString: resolveAppDatabaseUrl(), schema: MEDIA_JOB_SCHEMA, migrate: false, createSchema: false, schedule: options.schedule??false, reindex: false, application_name: "khidi-worker" });
  boss.on("error", () => { console.error("Khidi media queue error; inspect the worker and database health."); });
  await boss.start();
  const role = await boss.getDb().executeSql("SELECT current_user AS name");
  if (role.rows[0]?.name !== "hub_app") { await boss.stop(); throw new Error("Worker runtime requires hub_app."); }
  return boss;
}
/** Transactional enqueue: a delivery cannot be marked done without the pg-boss job. */
export async function dispatchMediaJobs(db: DbExecutor, boss: PgBoss, onlyJobId?: string) {
  return withDomainTransaction(db, {}, async (ctx) => {
    const pending = await ctx.tx.select({ delivery: outboxDeliveries, payload: outboxEvents.payloadJson }).from(outboxDeliveries)
      .innerJoin(outboxEvents, eq(outboxEvents.id, outboxDeliveries.outboxEventId))
      .where(and(eq(outboxDeliveries.consumer, "media-jobs"), eq(outboxDeliveries.status, "PENDING"), onlyJobId ? eq(outboxEvents.aggregateId, onlyJobId) : undefined))
      .limit(50).for("update", { skipLocked: true, of: outboxDeliveries });
    for (const { delivery, payload } of pending) {
      if (!MEDIA_QUEUES.includes(payload.jobType as typeof MEDIA_QUEUES[number]) || typeof payload.jobId !== "string") throw new Error("Invalid media job event.");
      await boss.send(String(payload.jobType), { jobId: payload.jobId, generation: payload.generation ?? 0 }, { id: delivery.id, db: fromDrizzle(ctx.tx, sql) });
      await ctx.tx.update(outboxDeliveries).set({ status: "DELIVERED", deliveredAt: new Date(), attempts: delivery.attempts + 1 }).where(eq(outboxDeliveries.id, delivery.id));
      await ctx.recordAudit({ action: "MEDIA_JOB_DISPATCHED", entityType: "outbox_delivery", entityId: delivery.id, after: { jobId: payload.jobId } });
      await ctx.emitOutboxEvent({ eventType: "MEDIA_JOB_UPDATED", aggregateType: "outbox_delivery", aggregateId: delivery.id, payload: { dispatched: true, jobId: payload.jobId }, consumers: [] });
    }
    return pending.length;
  });
}
export async function startMediaWorkers(db: DbExecutor, storage: MediaStorage, boss: PgBoss, handlers: MediaJobHandlers = { publish: synchronizePublicMedia }) {
  await boss.work("media-dead-letter", { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) { const data = job.data as { jobId: string; generation: number }; await markMediaJobDeadLetter(db, data.jobId, data.generation); }
  });
  for (const queue of MEDIA_QUEUES) await boss.work(queue, { batchSize: 1, perJobResults: true }, async (jobs) => {
    const results = [];
    for (const job of jobs) {
      try {
        const data = job.data as { jobId: string; generation: number };
        const result = await executeMediaJob(db, storage, data.jobId, handlers, data.generation);
        results.push({ id: job.id, status: result?.deadLetter ? "deadletter" as const : "completed" as const });
      } catch { results.push({ id: job.id, status: "failed" as const }); }
    }
    return results;
  });
}

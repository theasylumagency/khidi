import { nowUtc } from "@khidi/shared";
import { getDb } from "@khidi/db";
import { createMediaJobRuntime, dispatchMediaJobs, startMediaWorkers, getMediaStorage, MEDIA_QUEUES } from "@khidi/media";
import { AI_JOB_NAMES, configuredAiProvider, dispatchAiJobs, startAiWorkers } from "@khidi/ai";
import { dispatchReservationJobs, startReservationWorkers } from "@khidi/fulfillment/jobs";
import { RESERVATION_QUEUE, RESERVATION_DEAD_LETTER } from "@khidi/fulfillment/job-names";
import { fanoutStorefrontEvents, dispatchStorefrontWebhooks } from "@khidi/publishing/webhooks";

export function getWorkerHealthStatus() {
  return {
    service: "khidi-worker",
    status: "ok",
    registeredQueues: [...MEDIA_QUEUES, "media-dead-letter", ...AI_JOB_NAMES, "ai-dead-letter",RESERVATION_QUEUE,RESERVATION_DEAD_LETTER],
    timestamp: nowUtc().toISOString()
  };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("index.ts")) {
  const db = getDb(), storage = getMediaStorage(), boss = await createMediaJobRuntime();
  await startMediaWorkers(db, storage, boss);
  await startAiWorkers(db, storage, boss, configuredAiProvider());
  await startReservationWorkers(db,boss);
  let running = false;
  const dispatch = async () => {
    if (running) return;
    running = true;
    try { await dispatchMediaJobs(db, boss); await dispatchAiJobs(db, boss); await dispatchReservationJobs(db,boss); await fanoutStorefrontEvents(db); await dispatchStorefrontWebhooks(db); }
    catch { console.error("Khidi job dispatch failed; pending events remain durable."); }
    finally { running = false; }
  };
  await dispatch();
  const timer = setInterval(() => { void dispatch(); }, 1000);
  const stop = () => { clearInterval(timer); void boss.stop({ graceful: true }).then(() => process.exit(0)); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  console.log(JSON.stringify(getWorkerHealthStatus()));
}

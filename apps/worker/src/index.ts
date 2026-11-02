import { AI_JOB_NAMES } from "@khidi/ai";
import { nowUtc } from "@khidi/shared";
import { getDb } from "@khidi/db";
import { createMediaJobRuntime, dispatchMediaJobs, startMediaWorkers, getMediaStorage, MEDIA_QUEUES } from "@khidi/media";

export function getWorkerHealthStatus() {
  return {
    service: "khidi-worker",
    status: "ok",
    registeredQueues: [...MEDIA_QUEUES, ...AI_JOB_NAMES, "outbox-dispatch", "daily-movement-reports"],
    timestamp: nowUtc().toISOString()
  };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("index.ts")) {
  const db = getDb(), storage = getMediaStorage(), boss = await createMediaJobRuntime();
  await startMediaWorkers(db, storage, boss);
  let running = false;
  const dispatch = async () => { if (running) return; running = true; try { await dispatchMediaJobs(db, boss); } catch { console.error("Khidi media dispatch failed; pending events remain durable."); } finally { running = false; } };
  await dispatch();
  const timer = setInterval(() => { void dispatch(); }, 1000);
  const stop = () => { clearInterval(timer); void boss.stop({ graceful: true }).then(() => process.exit(0)); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  console.log(JSON.stringify(getWorkerHealthStatus()));
}

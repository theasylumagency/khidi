import { AI_JOB_NAMES } from "@khidi/ai";
import { nowUtc } from "@khidi/shared";

export function getWorkerHealthStatus() {
  return {
    service: "agrotrade-worker",
    status: "ok",
    registeredQueues: [...AI_JOB_NAMES, "outbox-dispatch", "daily-movement-reports"],
    timestamp: nowUtc().toISOString()
  };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("index.ts")) {
  console.log(JSON.stringify(getWorkerHealthStatus()));
}

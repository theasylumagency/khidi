import { deployMediaJobs } from "../packages/media/src/jobs-runtime.ts";
import { AI_JOB_NAMES } from "../packages/ai/src/job-names.ts";
import { RESERVATION_QUEUE } from "../packages/fulfillment/src/job-names.ts";
await deployMediaJobs(AI_JOB_NAMES,[RESERVATION_QUEUE]);
console.log("Khidi media, AI and reservation queues deployed; runtime grants applied.");

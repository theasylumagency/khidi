import { deployMediaJobs } from "../packages/media/src/jobs-runtime.ts";
import { AI_JOB_NAMES } from "../packages/ai/src/job-names.ts";
await deployMediaJobs(AI_JOB_NAMES);
console.log("Khidi media and AI queues deployed; runtime grants applied.");

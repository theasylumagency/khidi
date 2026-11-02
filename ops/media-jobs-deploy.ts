import { deployMediaJobs } from "../packages/media/src/jobs-runtime.ts";
await deployMediaJobs();
console.log("Khidi media queues deployed; runtime grants applied.");

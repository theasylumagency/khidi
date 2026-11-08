import { deployMediaJobs } from "../packages/media/src/jobs-runtime.ts";
import { AI_JOB_NAMES } from "../packages/ai/src/job-names.ts";
import { RESERVATION_QUEUE } from "../packages/fulfillment/src/job-names.ts";
import { REPORT_QUEUE,REPORT_DEAD_LETTER } from "../packages/reports/src/daily.ts";
await deployMediaJobs(AI_JOB_NAMES,[RESERVATION_QUEUE],{queue:REPORT_QUEUE,deadLetter:REPORT_DEAD_LETTER,cron:"5 0 * * *"});
console.log("Khidi media, AI, reservation and daily-report queues deployed; runtime grants applied.");

import type { PgBoss } from "pg-boss";
import type { DbExecutor } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import type { MediaStorage } from "@khidi/media/storage";
import { generateDailyReports,REPORT_QUEUE,REPORT_DEAD_LETTER } from "./daily.ts";
export async function startReportWorkers(db:DbExecutor,storage:MediaStorage,boss:PgBoss) {
 await boss.work(REPORT_QUEUE,{batchSize:1},async jobs=>{for(const job of jobs){
  const data=job.data as {day?:string};await generateDailyReports(db,storage,data?.day);
 }});
 await boss.work(REPORT_DEAD_LETTER,{batchSize:1},async jobs=>{for(const job of jobs){
  // A failed report leaves its snapshot/files durable for safe manual re-enqueue.
  await withDomainTransaction(db,{principalType:"SYSTEM_JOB",principalId:REPORT_QUEUE},async ctx=>{
   await ctx.recordAudit({action:"DAILY_REPORT_JOB_FAILED",entityType:"report_job",entityId:job.id,after:{queue:REPORT_QUEUE}});
   await ctx.emitOutboxEvent({eventType:"NOTIFICATION_SIGNAL",aggregateType:"report_job",aggregateId:job.id,payload:{type:"JOB_FAILED",jobId:job.id},consumers:["notifications"]});
  });
 }});
}

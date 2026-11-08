import { sql,eq } from "drizzle-orm";
import { legalEntities,type DbExecutor } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { acquireDomainLocks } from "@khidi/domain/locking";
import { createUuidV7,AppError } from "@khidi/shared";
import type { MediaStorage } from "@khidi/media/storage";
import { assertReportAccess,reportEntities } from "./access.ts";
import { buildMovementReport,reportRangeSchema,type MovementReport } from "./movements.ts";
import { exportReport } from "./export.ts";
export const REPORT_QUEUE="daily-movement-reports",REPORT_DEAD_LETTER="report-dead-letter";
export const tbilisiDay=(now=new Date())=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tbilisi",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
export function previousTbilisiDay(now=new Date()) {return new Date(Date.parse(tbilisiDay(now)+"T00:00:00Z")-86400000).toISOString().slice(0,10);}
type Daily={id:string;entityId:string;day:string;snapshot:MovementReport};
async function lookup(db:DbExecutor,entityId:string,day:string) {
 const r=await db.execute(sql`SELECT id,legal_entity_id AS "entityId",report_day::text AS day,snapshot_json AS snapshot FROM daily_reports
  WHERE legal_entity_id=${entityId}::uuid AND report_day=${day}::date`);return r.rows[0] as Daily|undefined;
}
/** Frozen report snapshot first; immutable files can be retried after a process crash. */
export async function generateDailyReport(db:DbExecutor,storage:MediaStorage,entityId:string,day:string) {
 reportRangeSchema.parse({entityId,from:day,to:day});
 if(day>=tbilisiDay())throw new AppError("VALIDATION_ERROR","Only completed Tbilisi days can be reported.");
 let report=await lookup(db,entityId,day);
 if(!report) {
  const snapshot=await buildMovementReport(db,{entityId,from:day,to:day,availability:true});
  report=await withDomainTransaction(db,{principalType:"SYSTEM_JOB",principalId:REPORT_QUEUE},async ctx=>{
   await acquireDomainLocks(ctx.tx,{advisoryKeys:["report:"+entityId+":"+day]});
   const existing=await lookup(ctx.tx,entityId,day);if(existing)return existing;
   const id=createUuidV7();
   await ctx.tx.execute(sql`INSERT INTO daily_reports(id,legal_entity_id,report_day,snapshot_json)
    VALUES(${id}::uuid,${entityId}::uuid,${day}::date,${JSON.stringify(snapshot)}::jsonb)`);
   await ctx.recordAudit({action:"DAILY_REPORT_SNAPSHOT_CREATED",entityType:"daily_report",entityId:id,after:{legalEntityId:entityId,day}});
   await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"daily_report",aggregateId:id,payload:{snapshotReady:true},consumers:[]});
   return {id,entityId,day,snapshot};
  });
 }
 for(const format of ["CSV","XLSX"] as const) {
  const exists=await db.execute(sql`SELECT 1 FROM daily_report_files WHERE report_id=${report.id}::uuid AND format=${format}`);if(exists.rowCount)continue;
  const id=createUuidV7(),key="reports/"+id+"/report."+format.toLowerCase(),bytes=await exportReport(report.snapshot,format);
  const stored=await storage.putPrivate(key,bytes,format==="CSV"?"text/csv; charset=utf-8":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await withDomainTransaction(db,{principalType:"SYSTEM_JOB",principalId:REPORT_QUEUE},async ctx=>{
   const added=await ctx.tx.execute(sql`INSERT INTO daily_report_files(id,report_id,format,storage_key,sha256,bytes,storage_version_id)
    VALUES(${id}::uuid,${report!.id}::uuid,${format},${key},${stored.sha256},${stored.bytes},${stored.versionId??null})
    ON CONFLICT(report_id,format) DO NOTHING RETURNING id`);
   if(!added.rowCount)return;
   await ctx.recordAudit({action:"DAILY_REPORT_FILE_STORED",entityType:"daily_report",entityId:report!.id,after:{legalEntityId:entityId,day,format,sha256:stored.sha256,bytes:stored.bytes}});
   await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"daily_report",aggregateId:report!.id,payload:{format},consumers:[]});
  });
 }
 await withDomainTransaction(db,{principalType:"SYSTEM_JOB",principalId:REPORT_QUEUE},async ctx=>{
  const done=await ctx.tx.execute(sql`INSERT INTO daily_report_announcements(report_id) SELECT ${report!.id}::uuid
   WHERE (SELECT count(*) FROM daily_report_files WHERE report_id=${report!.id}::uuid)=2
   ON CONFLICT DO NOTHING RETURNING report_id`);
  if(!done.rowCount)return;
  await ctx.recordAudit({action:"DAILY_REPORT_READY",entityType:"daily_report",entityId:report!.id,after:{legalEntityId:entityId,day}});
  await ctx.emitOutboxEvent({eventType:"NOTIFICATION_SIGNAL",aggregateType:"daily_report",aggregateId:report!.id,
   payload:{type:"DAILY_REPORT_READY",reportId:report!.id,legalEntityId:entityId},consumers:["notifications"]});
 });
 return report.id;
}
export async function generateDailyReports(db:DbExecutor,storage:MediaStorage,day=previousTbilisiDay()) {
 const entities=await db.select({id:legalEntities.id}).from(legalEntities);
 for(const entity of entities)await generateDailyReport(db,storage,entity.id,day);
}
export async function dailyReportDetails(db:DbExecutor,userId:string,id:string) {
 if(!/^[a-f0-9-]{36}$/i.test(id))throw new AppError("NOT_FOUND","Report not found.");
 const r=await db.execute(sql`SELECT d.id,d.legal_entity_id AS "entityId",d.report_day::text AS day FROM daily_reports d
  JOIN daily_report_announcements a ON a.report_id=d.id WHERE d.id=${id}::uuid`);
 const report=r.rows[0] as {id:string;entityId:string;day:string}|undefined;
 if(!report)throw new AppError("NOT_FOUND","Report not found.");
 await assertReportAccess(db,userId,report.entityId);return report;
}
export async function recentDailyReports(db:DbExecutor,userId:string) {
 const entities=await reportEntities(db,userId);if(!entities.length)return [];
 const rows=await db.execute(sql`SELECT d.id,d.report_day::text AS day,e.legal_name AS entity FROM daily_reports d
  JOIN daily_report_announcements a ON a.report_id=d.id JOIN legal_entities e ON e.id=d.legal_entity_id
  WHERE d.legal_entity_id IN (${sql.join(entities.map(e=>sql`${e.id}::uuid`),sql`,`)}) ORDER BY d.report_day DESC,d.id DESC LIMIT 50`);
 return rows.rows as {id:string;day:string;entity:string}[];
}

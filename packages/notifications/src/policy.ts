import { eq } from "drizzle-orm";
import { allocations,fulfillmentRequests,productImages,productIntakes,reservations,scanTasks,skuContentVersions,stockPools,type DbExecutor,outboxEvents } from "@khidi/db";
import { sha256Hex } from "@khidi/shared";
import type { NotificationIntent,NotificationType,NotificationAudience } from "./model.ts";
type Event=typeof outboxEvents.$inferSelect;
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export async function notificationIntent(db:DbExecutor,e:Event):Promise<NotificationIntent> {
 const p=e.payloadJson;
 const intent=(type:NotificationType,audience:NotificationAudience,deepLink:string,state:unknown,key:string=type):NotificationIntent=>({type,audience,deepLink,stateKey:e.aggregateType+":"+e.aggregateId+":"+key,fingerprint:sha256Hex(JSON.stringify(state))});
 if(["STOCK_LOW","STOCK_OUT","STOCK_RECOVERED","REPLENISHMENT_CHANGED"].includes(e.eventType)) {
  const [row]=await db.select({allocation:allocations,owner:stockPools.ownerEntityId}).from(allocations).innerJoin(stockPools,eq(stockPools.id,allocations.poolId)).where(eq(allocations.id,e.aggregateId));
  if(row) {
   const replenish=e.eventType==="REPLENISHMENT_CHANGED",type=replenish ? p.status==="OPEN" ? "REPLENISHMENT_REQUESTED" : "REPLENISHMENT_UPDATED" : e.eventType as "STOCK_LOW"|"STOCK_OUT"|"STOCK_RECOVERED";
   return {...intent(type,"STOCK_OWNER","/inventory",p.status,replenish ? "replenishment:"+String(p.requestId) : "stock"),legalEntityId:row.owner};
  }
 }
 if(e.eventType==="STOCK_REVIEW_REQUIRED") {
  const job=p.reason==="RESERVATION_EXPIRY_DEAD_LETTER";
  return intent(job?"JOB_FAILED":"STOCK_REVIEW_REQUIRED","ADMIN",job?"/fulfillment":"/inventory",p,"stock-review");
 }
 if(["AI_JOB_UPDATED","MEDIA_JOB_UPDATED"].includes(e.eventType)) {
  return {...intent("JOB_FAILED","ADMIN",e.eventType==="AI_JOB_UPDATED"?"/evidence/jobs":"/media/jobs",{status:p.status,generation:p.generation},"job"),visible:p.status==="DEAD_LETTER"};
 }
 if(e.eventType==="WEBHOOK_DELIVERY_UPDATED")return {...intent("WEBHOOK_DEAD_LETTER","ADMIN","/fulfillment",p.action,"webhook"),visible:p.action==="WEBHOOK_DEAD_LETTER"};
 if(e.eventType==="FULFILLMENT_MODE_CHANGED")return intent("FULFILLMENT_MODE_CHANGED","ADMIN","/fulfillment",p);
 if(e.eventType==="NOTIFICATION_SIGNAL") {
  const type=p.type as NotificationType;
  if(type==="JOB_FAILED"&&e.aggregateType==="report_job")return intent("JOB_FAILED","ADMIN","/reports",p.jobId,"report-job");
  if(type==="DAILY_REPORT_READY"&&uuid(p.legalEntityId)&&uuid(p.reportId))return {...intent(type,"REPORT","/reports/"+p.reportId,p.reportId),legalEntityId:p.legalEntityId};
  if(type==="RESERVATION_EXPIRING") {
   const [header]=await db.select().from(reservations).where(eq(reservations.id,e.aggregateId));
   return {...intent(type,"FULFILLMENT","/fulfillment",p.transition??p),legalEntityId:uuid(p.sellerEntityId)?p.sellerEntityId:undefined,parameters:{expiresAt:String(p.expiresAt)},
    visible:!!header&&header.status==="RESERVED"&&header.paymentMethod==="BANK_INSTALLMENT"&&header.expiresAt.toISOString()===p.expiresAt&&uuid(p.sellerEntityId)};
  }
  if(type==="FULFILLMENT_OVERDUE")return intent(type,"FULFILLMENT","/fulfillment/"+e.aggregateId,p.transition??p);
 }
 if(e.eventType==="FULFILLMENT_STATUS_CHANGED"&&p.status==="ACTION_REQUIRED")return intent("RESERVATION_ACTION_REQUIRED","FULFILLMENT","/fulfillment/"+e.aggregateId,{status:p.status,reason:p.reason});
 if(e.eventType==="SCAN_TASK_CREATED"&&e.aggregateType==="fulfillment_request") {
  const [r]=await db.select().from(fulfillmentRequests).where(eq(fulfillmentRequests.id,e.aggregateId));
  // R8 remains disabled: never direct warehouse users to an unavailable PICK screen.
  return {...intent("FULFILLMENT_REQUESTED","FULFILLMENT","/fulfillment/"+e.aggregateId,"REQUESTED"),visible:!!r};
 }
 if(["SCAN_TASK_CREATED","SCAN_TASK_COMPLETED"].includes(e.eventType)&&e.aggregateType==="scan_task") {
  const [task]=await db.select().from(scanTasks).where(eq(scanTasks.id,e.aggregateId));
  if(task) {
   const type=e.eventType==="SCAN_TASK_COMPLETED" ? "SCAN_TASK_COMPLETED" : task.taskType==="PHOTO_REQUEST" ? "PHOTO_RETAKE_REQUIRED" : task.taskType==="EVIDENCE_REQUEST" ? "EVIDENCE_REQUESTED" : "SCAN_TASK_CREATED";
   return {...intent(type,"TASK","/warehouse/tasks/"+task.id,e.eventType,"task"),taskId:task.id,visible:!["PICK","PHYSICAL_COUNT"].includes(task.taskType)};
  }
 }
 if(e.eventType==="PRODUCT_REVIEW_REQUIRED") {
  const reason=String(p.reason??""),type=reason.startsWith("CONTENT_") ? "CONTENT_REVIEW_REQUIRED" : reason==="MERGE_EVIDENCE_CONFLICT" ? "MERGE_EVIDENCE_CONFLICT" : reason==="MERGE_UNDETERMINED" ? "MERGE_UNDETERMINED" : reason==="IDENTIFICATION_FAILED" ? "IDENTIFICATION_FAILED" : "PRODUCT_REVIEW_REQUIRED";
  return intent(type,reason.startsWith("MERGE_")||reason==="IDENTIFICATION_FAILED" ? "ADMIN" : "PRODUCT","/products/"+e.aggregateId,p,type);
 }
 if(e.eventType==="PRODUCT_UPDATED"&&e.aggregateType==="sku") {
  if(typeof p.approved==="boolean") {
   const [version]=uuid(p.contentVersionId)?await db.select().from(skuContentVersions).where(eq(skuContentVersions.id,p.contentVersionId)):[];
   return {...intent("CONTENT_REVIEW_REQUIRED","PRODUCT","/products/"+e.aggregateId,p.approved?"RESOLVED":version?{locale:version.locale,displayName:version.displayName,short:version.shortDescription,full:version.fullDescription,facts:version.verifiedFacts}:p),visible:!p.approved};
  }
  if(p.contentReviewRequired===false)return {...intent("CONTENT_REVIEW_REQUIRED","PRODUCT","/products/"+e.aggregateId,"RESOLVED"),visible:false};
  if(p.reason==="MERGE_EVIDENCE_CONFLICT"||p.reason==="MERGE_UNDETERMINED")return {...intent(p.reason,"ADMIN","/products/"+e.aggregateId,{resolvedFields:p.fields}),visible:false};
  if(p.reverificationRequired===false)return {...intent("PRODUCT_REVIEW_REQUIRED","PRODUCT","/products/"+e.aggregateId,"RESOLVED"),visible:false};
 }
 if(["PRODUCT_APPROVED","PRODUCT_ARCHIVED"].includes(e.eventType))return intent("PRODUCT_UPDATED","PRODUCT","/products/"+e.aggregateId,e.eventType);
 if(["PRODUCT_INTAKE_RECORDED","LABEL_STATUS_CHANGED"].includes(e.eventType)) {
  const [intake]=await db.select().from(productIntakes).where(eq(productIntakes.id,e.aggregateId));
  if(intake) {
   if(intake.reviewReason&&!intake.reviewedAt)return intent("PRODUCT_REVIEW_REQUIRED","ADMIN","/intakes/"+intake.id+"/review",intake.reviewReason);
   if(e.eventType==="PRODUCT_INTAKE_RECORDED"&&intake.resultState==="NEW_DRAFT"&&intake.matchedSkuId)return intent("NEW_PRODUCT_SCANNED","PRODUCT","/products/"+intake.matchedSkuId,"NEW_DRAFT");
   if(e.eventType==="PRODUCT_INTAKE_RECORDED"&&intake.resultState==="MANUAL_IDENTIFICATION_REQUIRED"&&intake.matchedSkuId)return intent("IDENTIFICATION_FAILED","ADMIN","/products/"+intake.matchedSkuId,intake.resultState);
   const type=e.eventType==="LABEL_STATUS_CHANGED" ? "LABEL_STATUS_CHANGED" : intake.resultState==="NEW_DRAFT" ? "NEW_PRODUCT_SCANNED" : "INTAKE_RECORDED";
   const link=intake.taskId ? "/warehouse/tasks/"+intake.taskId : "/intakes";
   return {...intent(type,intake.taskId?"TASK":"ADMIN",link,p.labelStatus??intake.resultState),...(intake.taskId ? {taskId:intake.taskId} : {})};
  }
 }
 if(["IMAGE_TIER2_CHECKED","IMAGE_QUALITY_DISAGREEMENT","PHOTO_ATTENTION_REPORTED","OFFLINE_PHOTO_DISCARDED"].includes(e.eventType)) {
  let skuId=p.skuId,intakeId=p.originalIntakeId??p.intakeId;
  if(e.aggregateType==="product_image") {const [image]=await db.select().from(productImages).where(eq(productImages.id,e.aggregateId));skuId=image?.skuId;intakeId=image?.intakeId;}
  const link=uuid(skuId) ? "/products/"+skuId : "/intakes";
  return {...intent(e.eventType==="IMAGE_QUALITY_DISAGREEMENT"?"PRODUCT_REVIEW_REQUIRED":"PHOTO_RETAKE_REQUIRED","ADMIN",link,p.needsRetake??p.needsAttention??true),visible:e.eventType!=="IMAGE_TIER2_CHECKED"||p.needsRetake===true};
 }
 return intent("SYSTEM_UPDATE","ADMIN","/history",e.eventType);
}

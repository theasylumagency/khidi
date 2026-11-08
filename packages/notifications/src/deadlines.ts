import { and,eq,sql } from "drizzle-orm";
import { fulfillmentRequests,reservations,storefronts,systemSettings,users,type DbExecutor } from "@khidi/db";
import { executeIdempotent,withDomainTransaction,type DomainTransactionContext } from "@khidi/domain";
import { AppError,createUuidV7 } from "@khidi/shared";
import { z } from "zod";
export async function installmentReminderLeadHours(db:DbExecutor){
 const [setting]=await db.select().from(systemSettings).where(eq(systemSettings.key,"bank_installment_notice_lead_hours"));
 const value=z.object({hours:z.number().int().min(1).max(8760)}).strict().safeParse(setting?.valueJson);
 if(!value.success)throw new Error("Invalid installment reminder lead time.");return value.data.hours;
}
async function signal(ctx:DomainTransactionContext,type:"RESERVATION_EXPIRING"|"FULFILLMENT_OVERDUE",entityType:"reservation"|"fulfillment_request",entityId:string,transition:string,payload:Record<string,unknown>){
 const id=createUuidV7(),result=await ctx.tx.execute(sql`INSERT INTO notification_signals(id,signal_key,entity_type,entity_id)
  VALUES(${id},${type+":"+entityId+":"+transition},${entityType},${entityId}) ON CONFLICT DO NOTHING RETURNING id`);
 if(!result.rowCount)return;
 await ctx.recordAudit({action:type,entityType:"notification_signal",entityId:id,after:{sourceId:entityId,transition}});
 await ctx.emitOutboxEvent({eventType:"NOTIFICATION_SIGNAL",aggregateType:entityType,aggregateId:entityId,payload:{type,transition,...payload},consumers:["notifications"]});
}
/** Called while reservation creation/extension owns its header decision point. */
export async function emitInstallmentExpiryNotice(ctx:DomainTransactionContext,header:typeof reservations.$inferSelect){
 if(header.paymentMethod!=="BANK_INSTALLMENT"||header.status!=="RESERVED")return;
 const hours=await installmentReminderLeadHours(ctx.tx);
 const [due]=await ctx.tx.select({id:reservations.id}).from(reservations).where(and(eq(reservations.id,header.id),sql`${reservations.expiresAt}<=clock_timestamp()+make_interval(hours=>${hours})`,sql`${reservations.expiresAt}>clock_timestamp()`));
 if(!due)return;
 const [store]=await ctx.tx.select({seller:storefronts.sellerEntityId}).from(storefronts).where(eq(storefronts.id,header.storefrontId));
 if(!store)throw new AppError("INVARIANT_VIOLATION","Reservation storefront missing.");
 await signal(ctx,"RESERVATION_EXPIRING","reservation",header.id,header.expiresAt.toISOString(),{sellerEntityId:store.seller,expiresAt:header.expiresAt.toISOString()});
}
export async function emitDeadlineNotifications(db:DbExecutor,onlyReservationId?:string){
 return withDomainTransaction(db,{principalType:"SYSTEM_JOB",principalId:createUuidV7()},async(ctx)=>{
  const hours=await installmentReminderLeadHours(ctx.tx);
  const headers=await ctx.tx.select().from(reservations).where(and(eq(reservations.paymentMethod,"BANK_INSTALLMENT"),eq(reservations.status,"RESERVED"),
   sql`${reservations.expiresAt}<=clock_timestamp()+make_interval(hours=>${hours})`,sql`${reservations.expiresAt}>clock_timestamp()`,onlyReservationId?eq(reservations.id,onlyReservationId):undefined,
   sql`NOT EXISTS(SELECT 1 FROM notification_signals s WHERE s.signal_key='RESERVATION_EXPIRING:' || ${reservations.id}::text || ':' || to_char(${reservations.expiresAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`))
    .limit(50).for("update",{skipLocked:true});
  for(const header of headers)await emitInstallmentExpiryNotice(ctx,header);
  if(!onlyReservationId){
   const overdue=await ctx.tx.select().from(fulfillmentRequests).where(and(sql`${fulfillmentRequests.status} IN ('REQUESTED','PICKING','PICKED','ACTION_REQUIRED')`,sql`${fulfillmentRequests.shipBy}<(clock_timestamp() AT TIME ZONE 'Asia/Tbilisi')::date`,
    sql`NOT EXISTS(SELECT 1 FROM notification_signals s WHERE s.signal_key='FULFILLMENT_OVERDUE:' || ${fulfillmentRequests.id}::text || ':' || ${fulfillmentRequests.shipBy}::text)`)).limit(50).for("update",{skipLocked:true});
   for(const request of overdue)await signal(ctx,"FULFILLMENT_OVERDUE","fulfillment_request",request.id,request.shipBy,{});
  }return headers.length;
 });
}
export async function setInstallmentReminderLead(db:DbExecutor,userId:string,key:string,raw:unknown){
 const input=z.object({action:z.literal("LEAD"),hours:z.number().int().min(1).max(8760)}).strict().safeParse(raw);
 if(!input.success||!z.string().uuid().safeParse(key).success)throw new AppError("VALIDATION_ERROR","Invalid reminder setting.");
 const requireAdmin=async(tx:DbExecutor)=>{const [user]=await tx.select().from(users).where(and(eq(users.id,userId),eq(users.active,true),eq(users.role,"ADMIN")));if(!user)throw new AppError("FORBIDDEN","Only ADMIN manages reminder policy.");};
 await requireAdmin(db);
 return executeIdempotent(db,{scope:"notification-lead:"+userId,idempotencyKey:key,payload:input.data},tx=>withDomainTransaction(tx,{userId},async(ctx)=>{
  await requireAdmin(ctx.tx);const before=await installmentReminderLeadHours(ctx.tx);
  await ctx.tx.update(systemSettings).set({valueJson:{hours:input.data.hours},updatedBy:userId,updatedAt:new Date()}).where(eq(systemSettings.key,"bank_installment_notice_lead_hours"));
  await ctx.recordAudit({action:"INSTALLMENT_REMINDER_LEAD_CHANGED",entityType:"system_setting",entityId:"bank_installment_notice_lead_hours",before:{hours:before},after:{hours:input.data.hours}});
  await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"user",aggregateId:userId,payload:{setting:"bank_installment_notice_lead_hours",hours:input.data.hours},consumers:[]});
  return {status:200,body:{ok:true}};
 }));
}

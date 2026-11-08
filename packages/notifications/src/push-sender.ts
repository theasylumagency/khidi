import { and,asc,eq,isNull,lte,or,sql } from "drizzle-orm";
import { notifications,notificationReceipts,outboxDeliveries,outboxEvents,pushAttempts,pushDeliveries,pushSubscriptions,registeredDevices,sessions,userPasskeys,users,type DbExecutor } from "@khidi/db";
import { withDomainTransaction,type DomainTransactionContext } from "@khidi/domain";
import { createUuidV7,decryptSecretAes256Gcm } from "@khidi/shared";
import { t } from "@khidi/i18n";
import { receiptAccess } from "./access.ts";
import { removePushSubscription } from "./push-subscriptions.ts";
import { sendWebPush,type BrowserPushSubscription,type PushTransport } from "./push-transport.ts";
async function audit(ctx:DomainTransactionContext,id:string,action:string,after:Record<string,unknown>){
 await ctx.recordAudit({action,entityType:"push_delivery",entityId:id,after});
 await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"push_delivery",aggregateId:id,payload:after,consumers:[]});
}
/** Notification content is intentionally absent from lock-screen payloads. */
export function safePushPayload(deepLink:string){
 if(!/^\/(products|intakes|warehouse\/tasks|evidence\/jobs|media\/jobs|inventory|fulfillment|reports|history)(\/[^?#]*)?$/.test(deepLink)||deepLink.includes(".."))throw new Error("Invalid push deep link.");
 return JSON.stringify({title:"Khidi",body:t("notification.push_body"),url:deepLink});
}
export async function createPushIntents(db:DbExecutor,onlyNotificationId?:string){
 return withDomainTransaction(db,{},async(ctx)=>{
  const rows=await ctx.tx.select({delivery:outboxDeliveries,event:outboxEvents}).from(outboxDeliveries).innerJoin(outboxEvents,eq(outboxEvents.id,outboxDeliveries.outboxEventId))
   .where(and(eq(outboxDeliveries.consumer,"notification-push"),eq(outboxDeliveries.status,"PENDING"),onlyNotificationId?eq(outboxEvents.aggregateId,onlyNotificationId):undefined)).limit(50).for("update",{of:outboxDeliveries,skipLocked:true});
  for(const {delivery,event}of rows){
   const [n]=await ctx.tx.select().from(notifications).where(eq(notifications.id,event.aggregateId));
   if(n){
    const subs=await ctx.tx.select({sub:pushSubscriptions}).from(pushSubscriptions).innerJoin(notificationReceipts,and(eq(notificationReceipts.userId,pushSubscriptions.userId),eq(notificationReceipts.notificationId,n.id)))
      .innerJoin(notifications,eq(notifications.id,notificationReceipts.notificationId))
      .where(and(eq(notificationReceipts.muted,false),n.level==="INFO"?eq(pushSubscriptions.infoOptIn,true):undefined,lte(pushSubscriptions.createdAt,notifications.createdAt)));
    for(const {sub}of subs)await ctx.tx.insert(pushDeliveries).values({id:createUuidV7(),notificationId:n.id,userId:sub.userId,subscriptionId:sub.id}).onConflictDoNothing();
   }
   await ctx.tx.update(outboxDeliveries).set({status:"DELIVERED",deliveredAt:new Date(),attempts:delivery.attempts+1}).where(eq(outboxDeliveries.id,delivery.id));
   await audit(ctx,delivery.id,"PUSH_INTENTS_CREATED",{notificationId:event.aggregateId});
  }return rows.length;
 });
}
async function validSubscription(db:DbExecutor,sub:typeof pushSubscriptions.$inferSelect){
 const [row]=await db.select({session:sessions,user:users}).from(sessions).innerJoin(users,eq(users.id,sessions.userId)).where(and(eq(sessions.id,sub.sessionId),eq(sessions.userId,sub.userId),eq(users.active,true),sql`${sessions.expiresAt}>clock_timestamp()`));
 if(!row)return false;
 if(row.session.deviceId){const [d]=await db.select().from(registeredDevices).where(eq(registeredDevices.id,row.session.deviceId));if(!d?.active||d.revokedAt)return false;}
 if(row.session.passkeyId){const [key]=await db.select().from(userPasskeys).where(eq(userPasskeys.id,row.session.passkeyId));if(!key||key.revokedAt||key.userId!==sub.userId)return false;}
 return true;
}
export async function dispatchPush(db:DbExecutor,options:{transport?:PushTransport;onlyDeliveryId?:string}={}){
 let attempts=0;
 for(let i=0;i<20;i++){
  const claim=await withDomainTransaction(db,{},async(ctx)=>{
   const [delivery]=await ctx.tx.select().from(pushDeliveries).where(and(eq(pushDeliveries.status,"PENDING"),lte(pushDeliveries.nextAttemptAt,sql`clock_timestamp()`),or(isNull(pushDeliveries.leasedUntil),lte(pushDeliveries.leasedUntil,sql`clock_timestamp()`)),options.onlyDeliveryId?eq(pushDeliveries.id,options.onlyDeliveryId):undefined))
     .orderBy(asc(pushDeliveries.nextAttemptAt)).limit(1).for("update",{skipLocked:true});
   if(!delivery)return null;
   const [sub]=delivery.subscriptionId?await ctx.tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.id,delivery.subscriptionId)):[];
   const [n]=await ctx.tx.select({n:notifications,muted:notificationReceipts.muted}).from(notificationReceipts).innerJoin(notifications,eq(notifications.id,notificationReceipts.notificationId))
     .where(and(await receiptAccess(ctx.tx,delivery.userId).catch(()=>sql`false`),eq(notifications.id,delivery.notificationId)));
   let valid=!!sub&&await validSubscription(ctx.tx,sub);
   if(sub&&!valid)await removePushSubscription(ctx,sub.id,"SESSION_OR_DEVICE_REVOKED");
   if(!valid||!n||n.muted||n.n.level==="INFO"&&!sub!.infoOptIn){
    await ctx.tx.update(pushDeliveries).set({status:"SKIPPED",leaseToken:null,leasedUntil:null}).where(eq(pushDeliveries.id,delivery.id));await audit(ctx,delivery.id,"PUSH_SKIPPED",{});return {skip:true as const};
   }
   if(delivery.attempts>=8){await ctx.tx.update(pushDeliveries).set({status:"DEAD_LETTER",leaseToken:null,leasedUntil:null}).where(eq(pushDeliveries.id,delivery.id));await audit(ctx,delivery.id,"PUSH_DEAD_LETTER",{});return {skip:true as const};}
   const token=createUuidV7();await ctx.tx.update(pushDeliveries).set({attempts:delivery.attempts+1,leaseToken:token,leasedUntil:sql`clock_timestamp()+interval '30 seconds'`}).where(eq(pushDeliveries.id,delivery.id));
   await audit(ctx,delivery.id,"PUSH_ATTEMPT_STARTED",{attempt:delivery.attempts+1});
   return {skip:false as const,delivery,sub:sub!,token,payload:safePushPayload(n.n.deepLink)};
  });
  if(!claim)break;if(claim.skip)continue;
  let status:number|null=null,errorCode:string|null=null;
  try{
   const subscription=JSON.parse(decryptSecretAes256Gcm(claim.sub.subscriptionEncrypted)) as BrowserPushSubscription;
   status=await (options.transport??sendWebPush)(subscription,claim.payload);if(status<200||status>=300)errorCode="HTTP_"+status;
  }catch{errorCode="TRANSPORT_ERROR";}
  await withDomainTransaction(db,{principalType:"SYSTEM_JOB",principalId:claim.token},async(ctx)=>{
   const [d]=await ctx.tx.select().from(pushDeliveries).where(eq(pushDeliveries.id,claim.delivery.id)).for("update");if(d?.leaseToken!==claim.token)return;
   if(status===404||status===410)await removePushSubscription(ctx,claim.sub.id,"PUSH_ENDPOINT_GONE");
   const succeeded=errorCode===null,gone=status===404||status===410;
   await ctx.tx.insert(pushAttempts).values({id:createUuidV7(),deliveryId:d.id,succeeded,responseStatus:status,errorCode});
   await ctx.tx.update(pushDeliveries).set({status:succeeded?"DELIVERED":gone?"SKIPPED":d.attempts>=8?"DEAD_LETTER":"PENDING",lastErrorCode:errorCode,leaseToken:null,leasedUntil:null,
    nextAttemptAt:sql`clock_timestamp()+make_interval(secs=>${Math.min(3600,2**Math.min(d.attempts,12))})`}).where(eq(pushDeliveries.id,d.id));
   await audit(ctx,d.id,succeeded?"PUSH_DELIVERED":gone?"PUSH_ENDPOINT_GONE":"PUSH_RETRY_SCHEDULED",{status,errorCode});
  });attempts++;
 }return attempts;
}

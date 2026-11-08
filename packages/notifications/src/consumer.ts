import { and,asc,eq,sql } from "drizzle-orm";
import { notifications,notificationPreferences,notificationReceipts,notificationStates,outboxDeliveries,outboxEvents,scanTasks,users,type DbExecutor } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { createUuidV7 } from "@khidi/shared";
import { notificationLevels } from "./model.ts";
import { notificationIntent } from "./policy.ts";
import { notificationVisibility } from "./access.ts";

/** Ordered per-consumer transition processing, without locking immutable events. */
export async function consumeNotifications(db:DbExecutor,onlyEventId?:string) {
 return withDomainTransaction(db,{},async(ctx)=>{
  const lock=await ctx.tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended('notifications:consumer',0)) AS acquired`);
  if(!(lock.rows[0] as {acquired:boolean}).acquired)return 0;
  const rows=await ctx.tx.select({delivery:outboxDeliveries,event:outboxEvents}).from(outboxDeliveries).innerJoin(outboxEvents,eq(outboxEvents.id,outboxDeliveries.outboxEventId))
   .where(and(eq(outboxDeliveries.consumer,"notifications"),eq(outboxDeliveries.status,"PENDING"),onlyEventId?eq(outboxEvents.id,onlyEventId):undefined))
   .orderBy(asc(outboxEvents.notificationPosition)).limit(50).for("update",{of:outboxDeliveries,skipLocked:true});
  for(const {delivery,event}of rows) {
   const intent=await notificationIntent(ctx.tx,event),[state]=await ctx.tx.select().from(notificationStates).where(eq(notificationStates.stateKey,intent.stateKey));
   const older=state&&state.sourcePosition>event.notificationPosition;
   if(!older&&state?.fingerprint!==intent.fingerprint) {
    await ctx.tx.insert(notificationStates).values({stateKey:intent.stateKey,fingerprint:intent.fingerprint,sourceEventId:event.id,sourceCreatedAt:event.createdAt,sourcePosition:event.notificationPosition})
      .onConflictDoUpdate({target:notificationStates.stateKey,set:{fingerprint:intent.fingerprint,sourceEventId:event.id,sourceCreatedAt:event.createdAt,sourcePosition:event.notificationPosition}});
    if(intent.visible!==false) {
     const id=createUuidV7(),level=notificationLevels[intent.type];
     await ctx.tx.insert(notifications).values({id,eventId:event.id,type:intent.type,level,titleKey:"notification.type."+intent.type,parametersJson:intent.parameters??{},
       deepLink:intent.deepLink,entityType:event.aggregateType,entityId:event.aggregateId,legalEntityId:intent.legalEntityId,taskId:intent.taskId,audience:intent.audience});
     const candidates=await ctx.tx.select({id:users.id,role:users.role}).from(users).where(eq(users.active,true));
     const [task]=intent.taskId?await ctx.tx.select().from(scanTasks).where(eq(scanTasks.id,intent.taskId)):[];
     for(const user of candidates) {
      if(task&&user.role==="ADMIN"&&task.createdBy!==user.id&&task.assigneeUserId!==user.id&&task.assigneeRole!=="ADMIN")continue;
      const [allowed]=await ctx.tx.select({id:notifications.id}).from(notifications).where(and(eq(notifications.id,id),await notificationVisibility(ctx.tx,user)));
      if(!allowed)continue;
      if(intent.audience==="REPORT"&&user.role!=="ADMIN") {
       const members=await ctx.tx.execute(sql`SELECT 1 FROM user_entity_memberships WHERE user_id=${user.id} AND legal_entity_id=${intent.legalEntityId} AND is_report_recipient`);
       if(!members.rowCount)continue;
      }
      const [preference]=level==="INFO" ? await ctx.tx.select().from(notificationPreferences).where(and(eq(notificationPreferences.userId,user.id),eq(notificationPreferences.type,intent.type))) : [];
      await ctx.tx.insert(notificationReceipts).values({notificationId:id,userId:user.id,muted:preference?.muted??false});
     }
     await ctx.recordAudit({action:"NOTIFICATION_CREATED",entityType:"notification",entityId:id,after:{type:intent.type,level,sourceEventId:event.id}});
     await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"notification",aggregateId:id,payload:{created:true},consumers:["notification-push"]});
    }
   }
   await ctx.tx.update(outboxDeliveries).set({status:"DELIVERED",deliveredAt:new Date(),attempts:delivery.attempts+1}).where(eq(outboxDeliveries.id,delivery.id));
   await ctx.recordAudit({action:"NOTIFICATION_EVENT_PROCESSED",entityType:"outbox_delivery",entityId:delivery.id,after:{eventId:event.id}});
   await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"outbox_delivery",aggregateId:delivery.id,payload:{processed:true},consumers:[]});
  }return rows.length;
 });
}

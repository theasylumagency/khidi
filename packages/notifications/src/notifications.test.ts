import { expect,it } from "vitest";
import { and,eq,inArray } from "drizzle-orm";
import { notificationPreferences,notificationReceipts,notifications,outboxDeliveries,outboxEvents,productIntakes,scanTasks,userEntityMemberships,users } from "@khidi/db";
import { withDomainTransaction,type DomainEventType } from "@khidi/domain";
import { createUuidV7 } from "@khidi/shared";
import { inventoryFixture } from "../../inventory/src/test-fixture.ts";
import { consumeNotifications,listNotifications,notificationUnreadCount,updateNotification } from "./index.ts";
import { notificationLevels } from "./model.ts";
import { t,type TranslationKey } from "@khidi/i18n";
async function emit(f:Awaited<ReturnType<typeof inventoryFixture>>,eventType:DomainEventType,aggregateType:string,aggregateId:string,payload:Record<string,unknown>,consumers=["notifications"]) {
 const result=await withDomainTransaction(f.db,f.actor,ctx=>ctx.emitOutboxEvent({eventType,aggregateType,aggregateId,payload,consumers}));
 await consumeNotifications(f.db,result.eventId);return result;
}
it("deduplicates replay and unchanged stock, keeps separate consumers independent and allows recovery then recurrence",async()=>{
 const f=await inventoryFixture(false),[own,other,warehouse]=await f.db.insert(users).values(["STOCK_MANAGER","STOCK_MANAGER","WAREHOUSE"].map(role=>({id:createUuidV7(),role,fullName:"Notification fixture"}))).returning();
 await f.db.insert(userEntityMemberships).values([{userId:own!.id,legalEntityId:f.entities[0]!.id},{userId:other!.id,legalEntityId:f.entities[1]!.id}]);
 const first=await emit(f,"STOCK_LOW","allocation",f.line.allocationId,{status:"LOW_STOCK",availableToSell:3},["notifications","storefront:"+f.stores[0]!.id]);
 expect(await consumeNotifications(f.db,first.eventId)).toBe(0);
 await emit(f,"STOCK_LOW","allocation",f.line.allocationId,{status:"LOW_STOCK",availableToSell:2});
 await emit(f,"STOCK_RECOVERED","allocation",f.line.allocationId,{status:"NORMAL"});
 await emit(f,"STOCK_LOW","allocation",f.line.allocationId,{status:"LOW_STOCK",availableToSell:3});
 const ownRows=await listNotifications(f.db,own!.id);expect(ownRows.rows.map(r=>r.notification.type)).toEqual(["STOCK_LOW","STOCK_RECOVERED","STOCK_LOW"]);
 expect((await listNotifications(f.db,other!.id)).rows).toHaveLength(0);expect((await listNotifications(f.db,warehouse!.id)).rows).toHaveLength(0);
 const [external]=await f.db.select().from(outboxDeliveries).where(and(eq(outboxDeliveries.outboxEventId,first.eventId),eq(outboxDeliveries.consumer,"storefront:"+f.stores[0]!.id)));expect(external!.status).toBe("PENDING");
 await expect(f.db.update(notifications).set({deepLink:"/history"}).where(eq(notifications.eventId,first.eventId))).rejects.toThrow();
 await f.db.delete(userEntityMemberships).where(eq(userEntityMemberships.userId,own!.id));expect(await notificationUnreadCount(f.db,own!.id)).toBe(0);
});
it("restricts warehouse notifications and reads to assigned tasks and permits muting only INFO in both domain and database",async()=>{
 const f=await inventoryFixture(false),[own,other]=await f.db.insert(users).values([0,1].map(()=>({id:createUuidV7(),role:"WAREHOUSE",fullName:"Task fixture"}))).returning();
 const [task]=await f.db.insert(scanTasks).values({id:createUuidV7(),taskType:"INTAKE_UNIQUE",title:"Own work",createdBy:f.actor.userId,assigneeUserId:own!.id}).returning();
 await updateNotification(f.db,own!.id,createUuidV7(),{action:"MUTE",type:"SCAN_TASK_CREATED",muted:true});
 const source=await emit(f,"SCAN_TASK_CREATED","scan_task",task!.id,{taskType:"INTAKE_UNIQUE"});
 expect((await listNotifications(f.db,own!.id)).rows).toHaveLength(0);const muted=(await listNotifications(f.db,own!.id,{includeMuted:true})).rows[0]!;expect(muted.muted).toBe(true);
 expect((await listNotifications(f.db,other!.id,{includeMuted:true})).rows).toHaveLength(0);
 await updateNotification(f.db,own!.id,createUuidV7(),{action:"MUTE",type:"SCAN_TASK_CREATED",muted:false});
 expect(await notificationUnreadCount(f.db,own!.id)).toBe(1);
 await expect(updateNotification(f.db,other!.id,createUuidV7(),{action:"READ",notificationId:muted.notification.id})).rejects.toThrow(/not found/);
 await updateNotification(f.db,own!.id,createUuidV7(),{action:"READ",notificationId:muted.notification.id});expect(await notificationUnreadCount(f.db,own!.id)).toBe(0);
 const [photo]=await f.db.insert(scanTasks).values({id:createUuidV7(),taskType:"PHOTO_REQUEST",title:"Photo work",createdBy:f.actor.userId,assigneeUserId:own!.id,targetSkuId:f.sku.id,photoRequestNote:"Capture missing main",requestedPhotoSlotsJson:["MAIN"]}).returning();
 const action=await emit(f,"SCAN_TASK_CREATED","scan_task",photo!.id,{taskType:"PHOTO_REQUEST"});
 const [n]=await f.db.select().from(notifications).where(eq(notifications.eventId,action.eventId));
 await expect(updateNotification(f.db,own!.id,createUuidV7(),{action:"MUTE",type:"PHOTO_RETAKE_REQUIRED",muted:true})).rejects.toThrow(/INFO/);
 await expect(f.db.update(notificationReceipts).set({muted:true}).where(and(eq(notificationReceipts.notificationId,n!.id),eq(notificationReceipts.userId,own!.id)))).rejects.toThrow(/INFO/);
 await expect(f.db.insert(notificationPreferences).values({userId:own!.id,type:"PHOTO_RETAKE_REQUIRED",muted:true})).rejects.toThrow();
 await f.db.update(scanTasks).set({assigneeUserId:other!.id}).where(eq(scanTasks.id,photo!.id));
 expect((await listNotifications(f.db,own!.id)).rows.some(r=>r.notification.id===n!.id)).toBe(false);expect(source.eventId).toBeDefined();
});
it("resets review deduplication after resolution without copying evidence, prices or secrets into notification data",async()=>{
 const f=await inventoryFixture(false),payload={skuId:f.sku.id,reason:"IDENTITY_REVERIFICATION",confidence:"LOW",reverificationRequired:true};
 const a=await emit(f,"PRODUCT_REVIEW_REQUIRED","sku",f.sku.id,payload);
 await emit(f,"PRODUCT_REVIEW_REQUIRED","sku",f.sku.id,payload);
 await emit(f,"PRODUCT_UPDATED","sku",f.sku.id,{skuId:f.sku.id,reverificationRequired:false});
 const b=await emit(f,"PRODUCT_REVIEW_REQUIRED","sku",f.sku.id,payload);
 const rows=await f.db.select().from(notifications).where(inArray(notifications.eventId,[a.eventId,b.eventId]));expect(rows).toHaveLength(2);expect(rows.every(r=>JSON.stringify(r.parametersJson)==="{}")).toBe(true);
});
it("maps all producer families to safe recipient audiences and translated titles",async()=>{
 const f=await inventoryFixture(false);
 const cases=[
  ["PRODUCT_REVIEW_REQUIRED","sku",{reason:"MERGE_EVIDENCE_CONFLICT"},"MERGE_EVIDENCE_CONFLICT"],
  ["PRODUCT_REVIEW_REQUIRED","sku",{reason:"CONTENT_FACT_CHANGED"},"CONTENT_REVIEW_REQUIRED"],
  ["PRODUCT_REVIEW_REQUIRED","sku",{reason:"IDENTIFICATION_FAILED"},"IDENTIFICATION_FAILED"],
  ["PRODUCT_APPROVED","product",{},"PRODUCT_UPDATED"],["PRODUCT_ARCHIVED","product",{},"PRODUCT_UPDATED"],
  ["AI_JOB_UPDATED","ai_job",{status:"DEAD_LETTER"},"JOB_FAILED"],["MEDIA_JOB_UPDATED","media_job",{status:"DEAD_LETTER"},"JOB_FAILED"],
  ["WEBHOOK_DELIVERY_UPDATED","outbox_delivery",{action:"WEBHOOK_DEAD_LETTER"},"WEBHOOK_DEAD_LETTER"],
  ["STOCK_REVIEW_REQUIRED","stock_review",{severity:"CRITICAL"},"STOCK_REVIEW_REQUIRED"],
  ["FULFILLMENT_STATUS_CHANGED","fulfillment_request",{status:"ACTION_REQUIRED"},"RESERVATION_ACTION_REQUIRED"],
  ["FULFILLMENT_MODE_CHANGED","user",{mode:"SIMPLIFIED_FULFILLMENT"},"FULFILLMENT_MODE_CHANGED"],
  ["PHOTO_ATTENTION_REPORTED","photo_attention",{},"PHOTO_RETAKE_REQUIRED"],["OFFLINE_PHOTO_DISCARDED","offline_photo",{},"PHOTO_RETAKE_REQUIRED"],
  ["IMAGE_TIER2_CHECKED","product_image",{needsRetake:true},"PHOTO_RETAKE_REQUIRED"],["IMAGE_QUALITY_DISAGREEMENT","product_image",{},"PRODUCT_REVIEW_REQUIRED"]
 ] as const;
 for(const [eventType,aggregateType,payload,type]of cases) {
  const event=await withDomainTransaction(f.db,f.actor,ctx=>ctx.emitOutboxEvent({eventType,aggregateType,aggregateId:f.sku.id,payload:{...payload},consumers:["notifications"]}));
  await consumeNotifications(f.db,event.eventId);
  const [n]=await f.db.select().from(notifications).where(eq(notifications.eventId,event.eventId));expect(n?.type).toBe(type);
 }
 for(const type of Object.keys(notificationLevels))expect(t(("notification.type."+type) as TranslationKey)).toBeTruthy();
});
it("handles real intake and label records without sending an inaccessible intake review link to operators",async()=>{
 const f=await inventoryFixture(false);
 const [intake]=await f.db.insert(productIntakes).values({id:createUuidV7(),sourceMode:"QUICK_SCAN",scannedBy:f.actor.userId,clientDeviceId:createUuidV7(),
  isNoBarcode:true,matchedSkuId:f.sku.id,resultState:"NEW_DRAFT",idempotencyKey:createUuidV7(),requestHash:"a".repeat(64),scannedAt:new Date(),acceptanceResponseJson:{}}).returning();
 const created=await emit(f,"PRODUCT_INTAKE_RECORDED","product_intake",intake!.id,{});
 const [n]=await f.db.select().from(notifications).where(eq(notifications.eventId,created.eventId));expect(n).toMatchObject({type:"NEW_PRODUCT_SCANNED",audience:"PRODUCT",deepLink:"/products/"+f.sku.id});
 const label=await emit(f,"LABEL_STATUS_CHANGED","product_intake",intake!.id,{labelStatus:"PRINTED"});
 expect((await f.db.select().from(notifications).where(eq(notifications.eventId,label.eventId)))[0]?.type).toBe("LABEL_STATUS_CHANGED");
});

import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { outboxDeliveries, outboxEvents, storefrontListings, storefronts, users, webhookDeliveries, webhookFanout, webhookMessages, type DbExecutor } from "@khidi/db";
import { executeIdempotent, withDomainTransaction, type DomainTransactionContext } from "@khidi/domain";
import { AppError, createUuidV7, decryptSecretAes256Gcm, encryptSecretAes256Gcm, sha256Hex } from "@khidi/shared";
import { webhookSignature } from "@khidi/shared/webhook-signature";
import { z } from "zod";
import { catalogEventTypes, eventProductIds, projectWebhook } from "./webhook-projection.ts";
import { sendWebhook, webhookUrl, type WebhookTransport } from "./webhook-transport.ts";
export { verifyWebhookSignature } from "@khidi/shared/webhook-signature";
export { sendWebhook, webhookUrl } from "./webhook-transport.ts";
const MAX_ATTEMPTS=8,LEASE_MS=30000;
type Staff={userId:string};
async function staff(db:DbExecutor,p:Staff,admin=false) {
  const [user]=await db.select().from(users).where(eq(users.id,p.userId));
  if(!user?.active || !(admin ? ["ADMIN"] : ["ADMIN","ORDER_MANAGER"]).includes(user.role))throw new AppError("FORBIDDEN","Fulfillment access required.");
}
async function changed(ctx:DomainTransactionContext,id:string,action:string,after:Record<string,unknown>) {
  await ctx.recordAudit({action,entityType:"outbox_delivery",entityId:id,after});
  await ctx.emitOutboxEvent({eventType:"WEBHOOK_DELIVERY_UPDATED",aggregateType:"outbox_delivery",aggregateId:id,payload:after,consumers:[]});
}
export async function configureStorefrontWebhook(db:DbExecutor,p:Staff,key:string,raw:unknown) {
  const parsed=z.object({storefrontId:z.string().uuid(),url:z.string().max(2048).nullable(),rotateSecret:z.boolean().default(false)}).strict().safeParse(raw);
  if(!parsed.success)throw new AppError("VALIDATION_ERROR","Invalid webhook configuration.");const input=parsed.data;
  if(!z.string().uuid().safeParse(key).success)throw new AppError("VALIDATION_ERROR","Idempotency key required.");
  if(input.url)webhookUrl(input.url);
  await staff(db,p,true);let secret:string|undefined;
  const result=await executeIdempotent(db,{scope:"webhook-config:"+p.userId,idempotencyKey:key,payload:input},async(tx)=>withDomainTransaction(tx,{userId:p.userId},async(ctx)=>{
    await staff(ctx.tx,p,true);
    const [store]=await ctx.tx.select().from(storefronts).where(eq(storefronts.id,input.storefrontId)).for("update");
    if(!store)throw new AppError("NOT_FOUND","Storefront not found.");
    if(input.url && (!store.webhookSecretEncrypted || input.rotateSecret))secret=randomBytes(32).toString("hex");
    await ctx.tx.update(storefronts).set({webhookUrl:input.url,...(secret ? {webhookSecretEncrypted:encryptSecretAes256Gcm(secret)} : {})}).where(eq(storefronts.id,store.id));
    await changed(ctx,store.id,"WEBHOOK_CONFIGURED",{storefrontId:store.id,enabled:!!input.url,rotated:!!secret});
    return {status:200,body:{storefrontId:store.id,enabled:!!input.url}};
  }));
  return {...result,body:{...result.body,...(secret ? {secret} : {})}};
}
export async function listWebhookDeliveries(db:DbExecutor,p:Staff) {
  await staff(db,p);
  return db.select({delivery:outboxDeliveries,eventType:outboxEvents.eventType,createdAt:outboxEvents.createdAt}).from(outboxDeliveries).innerJoin(outboxEvents,eq(outboxEvents.id,outboxDeliveries.outboxEventId))
    .where(sql`${outboxDeliveries.consumer} LIKE 'storefront:%'`).orderBy(sql`${outboxEvents.createdAt} DESC`).limit(100);
}
export async function retryWebhook(db:DbExecutor,p:Staff,key:string,raw:unknown) {
  const parsed=z.object({deliveryId:z.string().uuid()}).strict().safeParse(raw);
  if(!parsed.success)throw new AppError("VALIDATION_ERROR","Invalid webhook retry.");const input=parsed.data;await staff(db,p,true);
  if(!z.string().uuid().safeParse(key).success)throw new AppError("VALIDATION_ERROR","Idempotency key required.");
  return executeIdempotent(db,{scope:"webhook-retry:"+p.userId,idempotencyKey:key,payload:input},async(tx)=>withDomainTransaction(tx,{userId:p.userId},async(ctx)=>{
    await staff(ctx.tx,p,true);
    const [d]=await ctx.tx.select().from(outboxDeliveries).where(eq(outboxDeliveries.id,input.deliveryId)).for("update");
    if(!d || !d.consumer.startsWith("storefront:") || d.status!=="DEAD_LETTER")throw new AppError("CONFLICT","Only dead letters can be retried.");
    await ctx.tx.update(outboxDeliveries).set({status:"PENDING",attempts:0,nextAttemptAt:new Date(),leaseToken:null,leasedUntil:null,lastErrorCode:null}).where(eq(outboxDeliveries.id,d.id));
    await changed(ctx,d.id,"WEBHOOK_RETRY_REQUESTED",{previousAttempts:d.attempts});
    return {status:200,body:{ok:true}};
  }));
}

/** Fan-out is its own durable consumer. Existing deliveries, media and notification consumers are independent. */
export async function fanoutStorefrontEvents(db:DbExecutor,onlyEventId?:string) {
  return withDomainTransaction(db,{},async(ctx)=>{
    // Events are append-only: locking them FOR UPDATE would require forbidden privileges.
    const lock=await ctx.tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended('webhook:fanout',0)) AS acquired`);
    if(!(lock.rows[0] as {acquired:boolean}).acquired)return 0;
    const events=await ctx.tx.select().from(outboxEvents).where(and(inArray(outboxEvents.eventType,catalogEventTypes),onlyEventId ? eq(outboxEvents.id,onlyEventId) : undefined,
      sql`NOT EXISTS(SELECT 1 FROM webhook_fanout f WHERE f.event_id=${outboxEvents.id})`)).orderBy(asc(outboxEvents.id)).limit(50);
    for(const event of events) {
      const ids=await eventProductIds(ctx.tx,event);
      const targets=ids.length ? await ctx.tx.selectDistinct({id:storefrontListings.storefrontId}).from(storefrontListings).where(and(inArray(storefrontListings.skuId,ids),event.storefrontId ? eq(storefrontListings.storefrontId,event.storefrontId) : undefined)) : [];
      for(const target of targets)await ctx.tx.insert(outboxDeliveries).values({id:createUuidV7(),outboxEventId:event.id,consumer:"storefront:"+target.id,status:"PENDING"}).onConflictDoNothing();
      await ctx.tx.insert(webhookFanout).values({eventId:event.id});
      await ctx.tx.update(outboxDeliveries).set({status:"DELIVERED",deliveredAt:new Date()}).where(and(eq(outboxDeliveries.outboxEventId,event.id),eq(outboxDeliveries.consumer,"publishing"),eq(outboxDeliveries.status,"PENDING")));
      await changed(ctx,event.id,"WEBHOOK_FANOUT_COMPLETED",{consumers:targets.length});
    }return events.length;
  });
}

/** Lease before network I/O. A crash permits safe redelivery of the same immutable event bytes. */
export async function dispatchStorefrontWebhooks(db:DbExecutor,options:{transport?:WebhookTransport;onlyDeliveryId?:string;maxAttempts?:number}={}) {
  const transport=options.transport??sendWebhook,max=options.maxAttempts??MAX_ATTEMPTS;
  let delivered=0;
  for(let n=0;n<20;n++) {
    const claimed=await withDomainTransaction(db,{},async(ctx)=>{
      const clock=await ctx.tx.execute(sql`SELECT clock_timestamp() AS now`),now=new Date((clock.rows[0] as {now:Date}).now);
      const [row]=await ctx.tx.select({delivery:outboxDeliveries,event:outboxEvents,store:storefronts}).from(outboxDeliveries)
        .innerJoin(outboxEvents,eq(outboxEvents.id,outboxDeliveries.outboxEventId))
        .innerJoin(storefronts,sql`${outboxDeliveries.consumer}='storefront:' || ${storefronts.id}::text`)
        .where(and(eq(outboxDeliveries.status,"PENDING"),lte(outboxDeliveries.nextAttemptAt,sql`clock_timestamp()`),or(isNull(outboxDeliveries.leasedUntil),lte(outboxDeliveries.leasedUntil,sql`clock_timestamp()`)),
          eq(storefronts.active,true),sql`${storefronts.webhookUrl} IS NOT NULL AND ${storefronts.webhookSecretEncrypted} IS NOT NULL`,options.onlyDeliveryId ? eq(outboxDeliveries.id,options.onlyDeliveryId) : undefined))
        .orderBy(asc(outboxDeliveries.nextAttemptAt)).limit(1).for("update",{of:outboxDeliveries,skipLocked:true});
      if(!row)return null;
      const d=row.delivery;
      if(d.attempts>=max) {
        await ctx.tx.update(outboxDeliveries).set({status:"DEAD_LETTER",leaseToken:null,leasedUntil:null,lastErrorCode:"LEASE_EXHAUSTED"}).where(eq(outboxDeliveries.id,d.id));
        await changed(ctx,d.id,"WEBHOOK_DEAD_LETTER",{attempts:d.attempts});return {skipped:true as const};
      }
      let [message]=await ctx.tx.select().from(webhookMessages).where(eq(webhookMessages.deliveryId,d.id));
      if(!message) {
        let payload:Awaited<ReturnType<typeof projectWebhook>>;
        try{payload=await ctx.tx.transaction(tx=>projectWebhook(tx,row.event,row.store.id));}
        catch{
          await ctx.tx.update(outboxDeliveries).set({status:"DEAD_LETTER",lastErrorCode:"PROJECTION_ERROR",leaseToken:null,leasedUntil:null}).where(eq(outboxDeliveries.id,d.id));
          await changed(ctx,d.id,"WEBHOOK_DEAD_LETTER",{code:"PROJECTION_ERROR"});return {skipped:true as const};
        }
        if(!payload) {
          await ctx.tx.update(outboxDeliveries).set({status:"DELIVERED",deliveredAt:now}).where(eq(outboxDeliveries.id,d.id));
          await changed(ctx,d.id,"WEBHOOK_NONPUBLIC_SKIPPED",{});return {skipped:true as const};
        }
        const body=JSON.stringify(payload);
        [message]=await ctx.tx.insert(webhookMessages).values({deliveryId:d.id,body,sha256:sha256Hex(body)}).returning();
      }
      if(sha256Hex(message!.body)!==message!.sha256){
        await ctx.tx.update(outboxDeliveries).set({status:"DEAD_LETTER",lastErrorCode:"MESSAGE_INTEGRITY",leaseToken:null,leasedUntil:null}).where(eq(outboxDeliveries.id,d.id));
        await changed(ctx,d.id,"WEBHOOK_DEAD_LETTER",{code:"MESSAGE_INTEGRITY"});return {skipped:true as const};
      }
      const token=createUuidV7();
      await ctx.tx.update(outboxDeliveries).set({attempts:d.attempts+1,leaseToken:token,leasedUntil:new Date(now.getTime()+LEASE_MS)}).where(eq(outboxDeliveries.id,d.id));
      await changed(ctx,d.id,"WEBHOOK_ATTEMPT_STARTED",{attempt:d.attempts+1});
      return {skipped:false as const,...row,token,body:message!.body};
    });
    if(!claimed)break;if(claimed.skipped)continue;
    let status:number|null=null,durationMs=0,code:string|null=null;
    const started=Date.now();
    try {
      const timestamp=String(Math.floor(Date.now()/1000)),secret=decryptSecretAes256Gcm(claimed.store.webhookSecretEncrypted!);
      const result=await transport(claimed.store.webhookUrl!,claimed.body,{"X-Khidi-Event-Id":claimed.event.id,"X-Khidi-Timestamp":timestamp,"X-Khidi-Signature":webhookSignature(secret,timestamp,claimed.body)});
      status=result.status;durationMs=result.durationMs;if(status<200 || status>=300)code="HTTP_"+status;
    }catch{code="TRANSPORT_ERROR";durationMs=Date.now()-started;}
    await withDomainTransaction(db,{principalType:"SYSTEM_JOB",principalId:claimed.token},async(ctx)=>{
      const [d]=await ctx.tx.select().from(outboxDeliveries).where(eq(outboxDeliveries.id,claimed.delivery.id)).for("update");
      if(d?.leaseToken!==claimed.token)return;
      const succeeded=code===null,dead=!succeeded&&d.attempts>=max;
      await ctx.tx.insert(webhookDeliveries).values({id:createUuidV7(),outboxEventId:claimed.event.id,outboxDeliveryId:d.id,storefrontId:claimed.store.id,responseStatus:status,durationMs:Math.max(0,Math.round(durationMs)),succeeded});
      await ctx.tx.update(outboxDeliveries).set({status:succeeded ? "DELIVERED" : dead ? "DEAD_LETTER" : "PENDING",deliveredAt:succeeded ? new Date() : null,
        nextAttemptAt:sql`clock_timestamp()+make_interval(secs=>${Math.min(3600,2**Math.min(d.attempts,12))})`,leaseToken:null,leasedUntil:null,lastErrorCode:code}).where(eq(outboxDeliveries.id,d.id));
      await changed(ctx,d.id,succeeded ? "WEBHOOK_DELIVERED" : dead ? "WEBHOOK_DEAD_LETTER" : "WEBHOOK_RETRY_SCHEDULED",{attempt:d.attempts,status,code});
    });
    delivered++;
  }return delivered;
}

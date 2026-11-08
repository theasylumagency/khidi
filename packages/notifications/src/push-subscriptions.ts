import { and,eq,sql } from "drizzle-orm";
import { pushSubscriptions,registeredDevices,sessions,users,type DbExecutor } from "@khidi/db";
import { executeIdempotent,withDomainTransaction,type DomainTransactionContext } from "@khidi/domain";
import { AppError,createUuidV7,encryptSecretAes256Gcm,sha256Hex } from "@khidi/shared";
import { z } from "zod";
export type PushPrincipal={userId:string;sessionId?:string};
const subscriptionSchema=z.object({endpoint:z.string().url().max(2048),expirationTime:z.number().nullable().optional(),keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]{87}={0,2}$/),auth:z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/)}).strict()}).strict();
function parse<T>(schema:z.ZodType<T>,raw:unknown):T{const p=schema.safeParse(raw);if(!p.success)throw new AppError("VALIDATION_ERROR","Invalid push subscription.");return p.data;}
async function pushSession(db:DbExecutor,p:PushPrincipal) {
 const [row]=p.sessionId?await db.select({session:sessions,user:users}).from(sessions).innerJoin(users,eq(users.id,sessions.userId)).where(and(eq(sessions.id,p.sessionId),eq(sessions.userId,p.userId),eq(users.active,true),sql`${sessions.expiresAt}>clock_timestamp()`)):[];
 if(!row)throw new AppError("UNAUTHORIZED","A current session is required.");
 if(row.session.deviceId){const [device]=await db.select().from(registeredDevices).where(eq(registeredDevices.id,row.session.deviceId));if(!device?.active||device.revokedAt)throw new AppError("UNAUTHORIZED","Device revoked.");}
 return row.session;
}
export async function pushSubscriptionStatus(db:DbExecutor,p:PushPrincipal,browserDeviceId:string) {
 parse(z.string().uuid(),browserDeviceId);await pushSession(db,p);
 const [subscription]=await db.select({id:pushSubscriptions.id,infoOptIn:pushSubscriptions.infoOptIn}).from(pushSubscriptions).where(and(eq(pushSubscriptions.userId,p.userId),eq(pushSubscriptions.sessionId,p.sessionId!),eq(pushSubscriptions.browserDeviceId,browserDeviceId)));
 return {enabled:!!subscription,infoOptIn:subscription?.infoOptIn??false};
}
export async function removePushSubscription(ctx:DomainTransactionContext,id:string,reason:string) {
 await ctx.tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id,id));
 await ctx.recordAudit({action:"PUSH_SUBSCRIPTION_REMOVED",entityType:"push_subscription",entityId:id,after:{reason}});
 await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"push_subscription",aggregateId:id,payload:{removed:true},consumers:[]});
}
export async function managePushSubscription(db:DbExecutor,p:PushPrincipal,key:string,raw:unknown) {
 const input=parse(z.discriminatedUnion("action",[
  z.object({action:z.literal("ENABLE"),browserDeviceId:z.string().uuid(),subscription:subscriptionSchema,infoOptIn:z.boolean().default(false)}).strict(),
  z.object({action:z.literal("DISABLE"),browserDeviceId:z.string().uuid()}).strict(),
  z.object({action:z.literal("INFO"),browserDeviceId:z.string().uuid(),infoOptIn:z.boolean()}).strict()
 ]),raw);
 parse(z.string().uuid(),key);await pushSession(db,p);
 if(input.action==="ENABLE") {
  const url=new URL(input.subscription.endpoint);
  if(url.protocol!=="https:"||url.username||url.password||url.hash)throw new AppError("VALIDATION_ERROR","HTTPS push endpoint required.");
 }
 // The idempotency fingerprint contains only a digest of subscription capability data.
 const payload=input.action==="ENABLE"?{...input,subscription:sha256Hex(JSON.stringify(input.subscription))}:input;
 return executeIdempotent(db,{scope:"push:"+p.userId+":"+p.sessionId,idempotencyKey:key,payload},tx=>withDomainTransaction(tx,{userId:p.userId},async(ctx)=>{
  const session=await pushSession(ctx.tx,p);
  const [old]=await ctx.tx.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.userId,p.userId),eq(pushSubscriptions.browserDeviceId,input.browserDeviceId))).for("update");
  if(input.action==="DISABLE"){if(old)await removePushSubscription(ctx,old.id,"USER_DISABLED");}
  else if(input.action==="INFO") {
   if(!old||old.sessionId!==session.id)throw new AppError("NOT_FOUND","Subscription not found.");
   await ctx.tx.update(pushSubscriptions).set({infoOptIn:input.infoOptIn}).where(eq(pushSubscriptions.id,old.id));
   await ctx.recordAudit({action:"PUSH_INFO_OPT_IN_CHANGED",entityType:"push_subscription",entityId:old.id,after:{infoOptIn:input.infoOptIn}});
   await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"push_subscription",aggregateId:old.id,payload:{preference:true},consumers:[]});
  }else {
   const hash=sha256Hex(input.subscription.endpoint),[owned]=await ctx.tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpointHash,hash));
   if(owned&&owned.userId!==p.userId)throw new AppError("CONFLICT","Push endpoint already registered.");
   const id=old?.id??createUuidV7();
   const values={userId:p.userId,sessionId:session.id,registeredDeviceId:session.deviceId,browserDeviceId:input.browserDeviceId,endpointHash:hash,subscriptionEncrypted:encryptSecretAes256Gcm(JSON.stringify(input.subscription)),infoOptIn:input.infoOptIn};
   await ctx.tx.insert(pushSubscriptions).values({id,...values}).onConflictDoUpdate({target:[pushSubscriptions.userId,pushSubscriptions.browserDeviceId],set:values});
   await ctx.recordAudit({action:"PUSH_SUBSCRIPTION_ENABLED",entityType:"push_subscription",entityId:id,after:{browserDeviceId:input.browserDeviceId,infoOptIn:input.infoOptIn}});
   await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"push_subscription",aggregateId:id,payload:{enabled:true},consumers:[]});
  }return {status:200,body:{ok:true}};
 }));
}

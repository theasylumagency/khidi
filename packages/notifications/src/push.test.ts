import { createECDH,randomBytes } from "node:crypto";
import { expect,it } from "vitest";
import { and,eq } from "drizzle-orm";
import webPush from "web-push";
import { auditLogs,notifications,outboxEvents,pushAttempts,pushDeliveries,pushSubscriptions,registeredDevices,sessions,users } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { createUuidV7,sha256Hex } from "@khidi/shared";
import { revokeSessionToken } from "../../auth/src/index.ts";
import { serviceAdminSessionFixture } from "../../auth/src/storefront-service.test-fixture.ts";
import { inventoryFixture } from "../../inventory/src/test-fixture.ts";
import { consumeNotifications,createPushIntents,dispatchPush,managePushSubscription,updateNotification } from "./index.ts";
import { DEVELOPMENT_VAPID_PRIVATE,DEVELOPMENT_VAPID_PUBLIC,vapidConfig } from "./push-config.ts";
import { sendWebPush } from "./push-transport.ts";
function subscription(){const curve=createECDH("prime256v1");curve.generateKeys();return {endpoint:"https://push.example.test/"+createUuidV7(),expirationTime:null,keys:{p256dh:curve.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")}};}
async function fixture(){const f=await inventoryFixture(false),session=await serviceAdminSessionFixture(f.db),p=session.principal,sub=subscription(),device=createUuidV7(),key=createUuidV7();
 await managePushSubscription(f.db,p,key,{action:"ENABLE",browserDeviceId:device,subscription:sub,infoOptIn:false});
 async function notice(eventType:"PRODUCT_REVIEW_REQUIRED"|"FULFILLMENT_MODE_CHANGED"="PRODUCT_REVIEW_REQUIRED"){
  const event=await withDomainTransaction(f.db,f.actor,ctx=>ctx.emitOutboxEvent({eventType,aggregateType:eventType==="PRODUCT_REVIEW_REQUIRED"?"sku":"user",aggregateId:f.sku.id,
   payload:{reason:"IDENTITY_REVERIFICATION",privateSupplier:"Never push this",price:10000,invoice:"INTERNAL"},consumers:["notifications"]}));
  await consumeNotifications(f.db,event.eventId);const [n]=await f.db.select().from(notifications).where(eq(notifications.eventId,event.eventId));await createPushIntents(f.db,n!.id);
  const [delivery]=await f.db.select().from(pushDeliveries).where(and(eq(pushDeliveries.notificationId,n!.id),eq(pushDeliveries.userId,p.userId)));return {n:n!,delivery};
 }return {...f,p,sub,device,key,session,notice};}
it("encrypts subscription capability data, uses an idempotent registry, and sends only a generic scoped payload",async()=>{
 const f=await fixture();await managePushSubscription(f.db,f.p,f.key,{action:"ENABLE",browserDeviceId:f.device,subscription:f.sub,infoOptIn:false});
 const subs=await f.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId,f.p.userId));expect(subs).toHaveLength(1);expect(subs[0]!.subscriptionEncrypted).not.toContain(f.sub.endpoint);
 const {n,delivery}=await f.notice();expect(delivery).toBeDefined();let sent=0;
 await dispatchPush(f.db,{onlyDeliveryId:delivery!.id,transport:async(sub,payload)=>{sent++;expect(sub.endpoint).toBe(f.sub.endpoint);const body=JSON.parse(payload);expect(Object.keys(body).sort()).toEqual(["body","title","url"]);expect(body.title).toBe("Khidi");expect(body.url).toBe("/products/"+f.sku.id);expect(payload).not.toMatch(/Never push|10000|INTERNAL|supplier|invoice|GEL|USD|₾/);return 201;}});
 expect(sent).toBe(1);await dispatchPush(f.db,{onlyDeliveryId:delivery!.id,transport:async()=>{throw new Error("Already delivered");}});expect(sent).toBe(1);
 expect(await f.db.select().from(pushAttempts).where(eq(pushAttempts.deliveryId,delivery!.id))).toHaveLength(1);
 const logs=await f.db.select().from(auditLogs).where(eq(auditLogs.entityId,subs[0]!.id));expect(JSON.stringify(logs)).not.toContain(f.sub.endpoint);expect(JSON.stringify(logs)).not.toContain(f.sub.keys.auth);
 expect(n.level).toBe("ACTION_REQUIRED");
});
for(const status of [404,410])it(`removes an expired push subscription on ${status} without losing the in-app notification`,async()=>{
 const f=await fixture(),{n,delivery}=await f.notice();await dispatchPush(f.db,{onlyDeliveryId:delivery!.id,transport:async()=>status});
 expect(await f.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId,f.p.userId))).toHaveLength(0);
 expect(await f.db.select().from(notifications).where(eq(notifications.id,n.id))).toHaveLength(1);
 expect((await f.db.select().from(pushDeliveries).where(eq(pushDeliveries.id,delivery!.id)))[0]).toMatchObject({status:"SKIPPED",subscriptionId:null,lastErrorCode:"HTTP_"+status});
});
it("requires separate INFO opt-in and preserves its per-type mute preference",async()=>{
 const f=await fixture(),first=await f.notice("FULFILLMENT_MODE_CHANGED");expect(first.delivery).toBeUndefined();
 await managePushSubscription(f.db,f.p,createUuidV7(),{action:"INFO",browserDeviceId:f.device,infoOptIn:true});
 const e=await withDomainTransaction(f.db,f.actor,ctx=>ctx.emitOutboxEvent({eventType:"FULFILLMENT_MODE_CHANGED",aggregateType:"user",aggregateId:createUuidV7(),payload:{mode:"CONTROLLED_FULFILLMENT"},consumers:["notifications"]}));await consumeNotifications(f.db,e.eventId);
 const [n]=await f.db.select().from(notifications).where(eq(notifications.eventId,e.eventId));await createPushIntents(f.db,n!.id);
 const deliveries=await f.db.select().from(pushDeliveries).where(and(eq(pushDeliveries.notificationId,n!.id),eq(pushDeliveries.userId,f.p.userId)));expect(deliveries).toHaveLength(1);
 await updateNotification(f.db,f.p.userId,createUuidV7(),{action:"MUTE",type:"FULFILLMENT_MODE_CHANGED",muted:true});
 await dispatchPush(f.db,{onlyDeliveryId:deliveries[0]!.id,transport:async()=>{throw new Error("Muted INFO must not be sent");}});
 expect((await f.db.select().from(pushDeliveries).where(eq(pushDeliveries.id,deliveries[0]!.id)))[0]!.status).toBe("SKIPPED");
});
it("cleans subscriptions on real logout and direct device revocation",async()=>{
 const f=await fixture();await revokeSessionToken(f.db,f.session.sessionToken);expect(await f.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId,f.p.userId))).toHaveLength(0);
 const [device]=await f.db.insert(registeredDevices).values({id:createUuidV7(),deviceName:"Push fixture",deviceTokenHash:sha256Hex(createUuidV7()),registeredBy:f.actor.userId}).returning();
 const [user]=await f.db.insert(users).values({id:createUuidV7(),role:"WAREHOUSE",fullName:"Push fixture"}).returning();
 const [session]=await f.db.insert(sessions).values({id:createUuidV7(),userId:user!.id,deviceId:device!.id,tokenHash:sha256Hex(createUuidV7()),authMethod:"WAREHOUSE_PIN",expiresAt:new Date(Date.now()+3600000)}).returning();
 await managePushSubscription(f.db,{userId:user!.id,sessionId:session!.id},createUuidV7(),{action:"ENABLE",browserDeviceId:createUuidV7(),subscription:subscription(),infoOptIn:false});
 await f.db.update(registeredDevices).set({active:false,revokedAt:new Date()}).where(eq(registeredDevices.id,device!.id));expect(await f.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId,user!.id))).toHaveLength(0);
});
it("refuses development or mismatched production VAPID and uses real web-push encryption with fresh keys",async()=>{
 expect(()=>vapidConfig({NODE_ENV:"production",NEXT_PUBLIC_VAPID_PUBLIC_KEY:DEVELOPMENT_VAPID_PUBLIC,VAPID_PRIVATE_KEY:DEVELOPMENT_VAPID_PRIVATE,VAPID_SUBJECT:"https://app.khidi.app"})).toThrow(/development/);
 const keys=webPush.generateVAPIDKeys(),config=vapidConfig({NODE_ENV:"production",NEXT_PUBLIC_VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:"https://app.khidi.app"});
 const payload=JSON.stringify({title:"Khidi",body:"Work",url:"/notifications"}),request=webPush.generateRequestDetails(subscription(),payload,{vapidDetails:config,contentEncoding:"aes128gcm"});
 expect(request.headers.Authorization).toContain("vapid");expect(request.body!.toString()).not.toContain(payload);
 await expect(sendWebPush({...subscription(),endpoint:"https://127.0.0.1/private"},payload)).rejects.toThrow(/REFUSED/);
});

import { afterEach, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLogs, outboxDeliveries, outboxEvents, storefrontListings, webhookDeliveries, webhookMessages } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { createUuidV7 } from "@khidi/shared";
import { webhookSignature } from "@khidi/shared/webhook-signature";
import { setFulfillmentMode } from "../../reservations/src/index.ts";
import { reserveOrder } from "../../fulfillment/src/index.ts";
import { reservationFixture } from "../../reservations/src/reservation.test-fixture.ts";
import { configureStorefrontWebhook, dispatchStorefrontWebhooks, fanoutStorefrontEvents, retryWebhook, verifyWebhookSignature, webhookUrl } from "./webhooks.ts";
afterEach(()=>vi.unstubAllEnvs());
async function fixture(){const f=await reservationFixture();const configured=await configureStorefrontWebhook(f.db,f.actor,createUuidV7(),{storefrontId:f.store.id,url:"http://127.0.0.1:3909/hook"});return {...f,secret:configured.body.secret!};}
it("signs exact immutable bytes, keeps provenance, and never forwards internal fields",async()=>{
  const f=await fixture();await setFulfillmentMode(f.db,{type:"USER",userId:f.actor.userId},createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
  const order=await reserveOrder(f.db,f.principal,createUuidV7(),{storefrontOrderRef:"Hook-1",paymentMethod:"PAY_ON_PICKUP",items:[{skuId:f.sku.id,quantity:1}],confirmation:{deliveryMethod:"PICKUP",shipBy:"2030-01-01",prices:[{skuId:f.sku.id,finalUnitPriceMinor:123,currency:"GEL"}]}});
  const [event]=await f.db.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId,order.body.fulfillmentRequestId!),eq(outboxEvents.eventType,"FULFILLMENT_STATUS_CHANGED")));
  const all=await f.db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId,order.body.fulfillmentRequestId!));
  const final=all.find((e)=>e.payloadJson.status==="HANDED_OVER")!;
  const [d]=await f.db.select().from(outboxDeliveries).where(eq(outboxDeliveries.outboxEventId,final.id));
  const seen:string[]=[];
  await dispatchStorefrontWebhooks(f.db,{onlyDeliveryId:d!.id,transport:async(_url,body,h)=>{
    expect(verifyWebhookSignature(f.secret,h["X-Khidi-Timestamp"]!,body,h["X-Khidi-Signature"]!)).toBe(true);
    expect(verifyWebhookSignature(f.secret,h["X-Khidi-Timestamp"]!,body+" ",h["X-Khidi-Signature"]!)).toBe(false);
    const parsed=JSON.parse(body);expect(parsed).toMatchObject({id:final.id,schemaVersion:1,data:{status:"HANDED_OVER",confirmation:"AUTO_ASSUMED"}});
    expect(body).not.toMatch(/KH-\d|accounting|supplier|apiKey|poolId|allocationId|fulfillmentMode|app\.khidi/);seen.push(body);return {status:204,durationMs:1};
  }});
  expect(seen).toHaveLength(1);expect(event).toBeDefined();
  expect(await dispatchStorefrontWebhooks(f.db,{onlyDeliveryId:d!.id,transport:async()=>{throw new Error("Must not replay delivered");}})).toBe(0);
  const [message]=await f.db.select().from(webhookMessages).where(eq(webhookMessages.deliveryId,d!.id));expect(message!.body).toBe(seen[0]);
  await expect(f.db.update(webhookMessages).set({body:"changed"}).where(eq(webhookMessages.deliveryId,d!.id))).rejects.toThrow();
});
it("retries independently, dead-letters, and an audited admin retry retains event identity and payload",async()=>{
  const f=await fixture();
  const {eventId,deliveryIds}=await withDomainTransaction(f.db,f.actor,ctx=>ctx.emitOutboxEvent({eventType:"STOCK_CHANGED",storefrontId:f.store.id,aggregateType:"sku",aggregateId:f.sku.id,payload:{skuId:f.sku.id,accountingItemId:"secret"},consumers:["storefront:"+f.store.id,"notifications"]}));
  const id=deliveryIds[0]!,seen:string[]=[];
  const fail=async(_url:string,body:string)=>{seen.push(body);return {status:500,durationMs:1};};
  await dispatchStorefrontWebhooks(f.db,{onlyDeliveryId:id,maxAttempts:2,transport:fail});
  let [d]=await f.db.select().from(outboxDeliveries).where(eq(outboxDeliveries.id,id));expect(d).toMatchObject({status:"PENDING",attempts:1,lastErrorCode:"HTTP_500"});expect(d!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  await f.db.update(outboxDeliveries).set({nextAttemptAt:new Date(0)}).where(eq(outboxDeliveries.id,id));
  await dispatchStorefrontWebhooks(f.db,{onlyDeliveryId:id,maxAttempts:2,transport:fail});
  [d]=await f.db.select().from(outboxDeliveries).where(eq(outboxDeliveries.id,id));expect(d!.status).toBe("DEAD_LETTER");
  const [other]=await f.db.select().from(outboxDeliveries).where(eq(outboxDeliveries.id,deliveryIds[1]!));expect(other).toMatchObject({status:"PENDING",attempts:0});
  await retryWebhook(f.db,f.actor,createUuidV7(),{deliveryId:id});
  await Promise.all([1,2].map(()=>dispatchStorefrontWebhooks(f.db,{onlyDeliveryId:id,transport:async(_u,body)=>{seen.push(body);return {status:204,durationMs:1};}})));
  expect(seen).toHaveLength(3);expect(new Set(seen).size).toBe(1);expect(JSON.parse(seen[0]!).id).toBe(eventId);
  expect(await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityId,id),eq(auditLogs.action,"WEBHOOK_RETRY_REQUESTED")))).toHaveLength(1);
  const attempts=await f.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.outboxDeliveryId,id));expect(attempts).toHaveLength(3);expect(attempts.every((a)=>a.responseBodyExcerpt===null)).toBe(true);
});
it("fans catalog events out once per own consumer and preserves other deliveries",async()=>{
  const f=await fixture();
  await f.db.insert(storefrontListings).values({id:createUuidV7(),storefrontId:f.stores[1]!.id,skuId:f.sku.id,enabled:false});
  const event=await withDomainTransaction(f.db,f.actor,ctx=>ctx.emitOutboxEvent({eventType:"PRODUCT_UPDATED",aggregateType:"sku",aggregateId:f.sku.id,payload:{supplier:"private"},consumers:["publishing","notifications"]}));
  await fanoutStorefrontEvents(f.db,event.eventId);
  const before=await f.db.select().from(outboxDeliveries).where(eq(outboxDeliveries.outboxEventId,event.eventId));
  expect(before.filter((d)=>d.consumer.startsWith("storefront:"))).toHaveLength(2);
  expect(before.find((d)=>d.consumer==="publishing")!.status).toBe("DELIVERED");expect(before.find((d)=>d.consumer==="notifications")!.status).toBe("PENDING");
  await fanoutStorefrontEvents(f.db,event.eventId);expect(await f.db.select().from(outboxDeliveries).where(eq(outboxDeliveries.outboxEventId,event.eventId))).toEqual(before);
});
it("returns a webhook secret once, validates endpoints and rejects stale signatures",async()=>{
  const f=await fixture(),key=createUuidV7(),input={storefrontId:f.store.id,url:"http://127.0.0.1:3909/hook",rotateSecret:true};
  expect((await configureStorefrontWebhook(f.db,f.actor,key,input)).body.secret).toBeDefined();expect((await configureStorefrontWebhook(f.db,f.actor,key,input)).body.secret).toBeUndefined();
  expect(()=>webhookUrl("http://127.0.0.1:3000",true)).toThrow();expect(()=>webhookUrl("https://app.khidi.app")).toThrow();expect(()=>webhookUrl("https://user:secret@example.test")).toThrow();
  const timestamp=String(Math.floor(Date.now()/1000)-301);expect(verifyWebhookSignature("secret",timestamp,"{}",webhookSignature("secret",timestamp,"{}"))).toBe(false);
});

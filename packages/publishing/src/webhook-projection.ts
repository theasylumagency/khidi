import { and, eq, inArray } from "drizzle-orm";
import { bundleComponents, fulfillmentRequests, imagePublications, outboxEvents, productImages, reservations, storefrontListings, type DbExecutor } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { storefrontProduct } from "./storefront-api.ts";
type Event=typeof outboxEvents.$inferSelect;
export const catalogEventTypes=["PRODUCT_APPROVED","PRODUCT_UPDATED","PRODUCT_ARCHIVED","LISTING_CHANGED","PRICE_CHANGED","STOCK_CHANGED","ONLINE_AVAILABILITY_SET","IMAGE_UPDATED","IMAGE_PUBLICATION_CHANGED","EVIDENCE_UPDATED"];

/** Internal payload is used only to locate records, never forwarded to a consumer. */
export async function eventProductIds(db:DbExecutor,event:Event) {
  let ids:string[]=[];
  if(["sku","product"].includes(event.aggregateType))ids=[event.aggregateId];
  else if(typeof event.payloadJson.skuId==="string" && /^[a-f0-9-]{36}$/i.test(event.payloadJson.skuId))ids=[event.payloadJson.skuId];
  else if(event.aggregateType==="storefront_listing")ids=(await db.select({id:storefrontListings.skuId}).from(storefrontListings).where(eq(storefrontListings.id,event.aggregateId))).map((r)=>r.id);
  else if(event.aggregateType==="product_image")ids=(await db.select({id:productImages.skuId}).from(productImages).where(eq(productImages.id,event.aggregateId))).flatMap((r)=>r.id ? [r.id] : []);
  else if(event.aggregateType==="image_publication")ids=(await db.select({id:imagePublications.skuId}).from(imagePublications).where(eq(imagePublications.id,event.aggregateId))).map((r)=>r.id);
  if(!ids.length)return [];
  const bundles=await db.select({id:bundleComponents.bundleSkuId}).from(bundleComponents).where(inArray(bundleComponents.componentSkuId,ids));
  return [...new Set([...ids,...bundles.map((r)=>r.id)])];
}
export async function projectWebhook(db:DbExecutor,event:Event,storefrontId:string) {
  let data:Record<string,unknown>|null=null;
  if(event.aggregateType==="fulfillment_request") {
    const [r]=await db.select().from(fulfillmentRequests).where(and(eq(fulfillmentRequests.id,event.aggregateId),eq(fulfillmentRequests.storefrontId,storefrontId)));
    if(r) {
      const statuses=["REQUESTED","PICKING","PICKED","ACTION_REQUIRED","HANDED_OVER","CANCELLED"];
      const status=String(event.payloadJson.status??"");
      const confirmation=event.payloadJson.confirmation;
      data={fulfillmentRequestId:r.id,reservationId:r.reservationId,storefrontOrderRef:r.storefrontOrderRef,status:statuses.includes(status) ? status : r.status,
        ...(["SCAN","MANUAL","AUTO_ASSUMED"].includes(String(confirmation)) ? {confirmation} : {}),
        ...(["UNIT_LOST","RESERVATION_TIMEOUT","EXPIRED_WITH_STAGED_UNITS"].includes(String(event.payloadJson.reason)) ? {reason:event.payloadJson.reason} : {})};
    }
  } else if(event.aggregateType==="reservation") {
    const [r]=await db.select().from(reservations).where(and(eq(reservations.id,event.aggregateId),eq(reservations.storefrontId,storefrontId)));
    if(r) data={reservationId:r.id,storefrontOrderRef:r.storefrontOrderRef,status:["RESERVED","COMMITTED","HANDED_OVER","EXPIRED","RELEASED","CANCELLED"].includes(String(event.payloadJson.status)) ? event.payloadJson.status : r.status,
      expiresAt:r.expiresAt.toISOString(),...(event.payloadJson.confirmation==="AUTO_ASSUMED" ? {confirmation:"AUTO_ASSUMED"} : {})};
  } else if(catalogEventTypes.includes(event.eventType)) {
    const ids=await eventProductIds(db,event);
    if(ids.length) {
      const own=await db.select({id:storefrontListings.skuId}).from(storefrontListings).where(and(eq(storefrontListings.storefrontId,storefrontId),inArray(storefrontListings.skuId,ids)));
      const products=[];
      for(const {id} of own) for(const locale of ["ka","en"]) {
        try {products.push(await storefrontProduct(db,storefrontId,id,locale));}
        catch(e){if(!(e instanceof AppError) || e.code!=="NOT_FOUND")throw e;products.push({skuId:id,locale,unpublished:true});}
      }
      if(products.length)data={products};
    }
  }
  return data ? {id:event.id,schemaVersion:1,type:event.eventType,occurredAt:event.createdAt.toISOString(),data} : null;
}

import { and, desc, eq } from "drizzle-orm";
import { fulfillmentHistory, fulfillmentRequests, reservationItems, reservations, type DbExecutor } from "@khidi/db";
import { authorizeWorkflowPrincipal } from "@khidi/inventory/workflow";
import { lockReservation, workflowCommand } from "@khidi/reservations/internal";
import { parseInput, type StorefrontPrincipal } from "@khidi/reservations";
import { AppError } from "@khidi/shared";
import { z } from "zod";
import { cancelLocked } from "./workflow.ts";
export const ensureFulfillmentSchema=z.object({reservationId:z.string().max(36).uuid()}).strict();
export const cancelStorefrontFulfillmentSchema=z.object({fulfillmentRequestId:z.string().max(36).uuid(),reason:z.string().trim().min(1).max(1000)}).strict();
export async function getStorefrontFulfillment(db:DbExecutor,p:StorefrontPrincipal,id:string) {
  await authorizeWorkflowPrincipal(db,p);
  const [request]=await db.select().from(fulfillmentRequests).where(and(eq(fulfillmentRequests.id,id),eq(fulfillmentRequests.storefrontId,p.storefrontId)));
  if(!request) throw new AppError("NOT_FOUND","Fulfillment not found.");
  const [last]=await db.select().from(fulfillmentHistory).where(eq(fulfillmentHistory.fulfillmentRequestId,id)).orderBy(desc(fulfillmentHistory.createdAt),desc(fulfillmentHistory.id)).limit(1);
  const items=await db.select().from(reservationItems).where(eq(reservationItems.reservationId,request.reservationId));
  return {fulfillmentRequestId:request.id,reservationId:request.reservationId,storefrontOrderRef:request.storefrontOrderRef,status:request.status,
    deliveryMethod:request.deliveryMethod,shipBy:request.shipBy,confirmation:last?.confirmation??null,requiresReturnToShelf:request.requiresReturnToShelf,
    lines:items.map((i)=>({skuId:i.skuId,quantity:i.quantity,finalUnitPriceMinor:i.finalUnitPriceMinor,currency:i.currency}))};
}
/** Compatibility create: confirmation already creates the one complete request atomically. */
export async function ensureStorefrontFulfillment(db:DbExecutor,p:StorefrontPrincipal,key:string,raw:unknown) {
  const input=parseInput(ensureFulfillmentSchema,raw);
  return workflowCommand(db,p,"ensure-fulfillment",key,input,async(ctx)=>{
    const [header]=await ctx.tx.select().from(reservations).where(and(eq(reservations.id,input.reservationId),eq(reservations.storefrontId,p.storefrontId)));
    if(!header) throw new AppError("NOT_FOUND","Reservation not found.");
    const [request]=await ctx.tx.select().from(fulfillmentRequests).where(eq(fulfillmentRequests.reservationId,header.id));
    if(!request) throw new AppError("CONFLICT","Confirm the order through RESERVE or COMMIT first.");
    const body=await getStorefrontFulfillment(ctx.tx,p,request.id);
    await ctx.recordAudit({action:"FULFILLMENT_ENSURED",entityType:"fulfillment_request",entityId:request.id,after:{existing:true}});
    await ctx.emitOutboxEvent({eventType:"FULFILLMENT_STATUS_CHANGED",aggregateType:"fulfillment_request",aggregateId:request.id,payload:{ensured:true},consumers:[]});
    return {status:200,body};
  });
}
export async function cancelStorefrontFulfillment(db:DbExecutor,p:StorefrontPrincipal,key:string,raw:unknown) {
  const input=parseInput(cancelStorefrontFulfillmentSchema,raw);
  return workflowCommand(db,p,"cancel-fulfillment",key,input,async(ctx)=>{
    const request=await getStorefrontFulfillment(ctx.tx,p,input.fulfillmentRequestId);
    const state=await lockReservation(ctx.tx,p,request.reservationId);
    return {status:200,body:await cancelLocked(ctx,p,state,input.reason)};
  });
}

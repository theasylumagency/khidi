import { eq } from "drizzle-orm";
import { reservations, type DbExecutor } from "@khidi/db";
import { workflowCommand } from "./commands.ts";
import { demand, expireLocked, lockReservation, scheduleExpiry, type StorefrontPrincipal } from "./internal.ts";
import { extendSchema, parseInput, type OrderResponse } from "./contracts.ts";
import { emitInstallmentExpiryNotice } from "@khidi/notifications/deadlines";
export { reserveSchema, commitSchema, extendSchema, releaseSchema, confirmationSchema, orderReferenceSchema, isCod, parseInput, type Confirmation, type ReserveInput, type CommitInput, type FulfillmentMode, type OrderResponse } from "./contracts.ts";
export { getFulfillmentMode, setFulfillmentMode } from "./mode.ts";
export type { StorefrontPrincipal } from "./internal.ts";

export async function extendReservation(db:DbExecutor,p:StorefrontPrincipal,key:string,raw:unknown) {
  const input=parseInput(extendSchema,raw);
  return workflowCommand<OrderResponse>(db,p,"extend",key,input,async(ctx)=>{
    const state=await lockReservation(ctx.tx,p,input.reservationId);
    if(state.header.status==="EXPIRED" || await expireLocked(ctx,p,state)) return {status:409,body:{code:"RESERVATION_EXPIRED"}};
    demand(state.header.status==="RESERVED","Only reservations can be extended; commitments do not expire.");
    const expiresAt=new Date(input.expiresAt);
    demand(expiresAt>state.header.expiresAt,"An extension must increase the deadline.");
    const [header]=await ctx.tx.update(reservations).set({expiresAt,updatedAt:new Date()}).where(eq(reservations.id,state.header.id)).returning();
    await scheduleExpiry(ctx,header!);
    await emitInstallmentExpiryNotice(ctx,header!);
    await ctx.recordAudit({action:"RESERVATION_EXTENDED",entityType:"reservation",entityId:header!.id,before:{expiresAt:state.header.expiresAt.toISOString()},after:{expiresAt:expiresAt.toISOString()}});
    await ctx.emitOutboxEvent({eventType:"RESERVATION_UPDATED",storefrontId:p.storefrontId,aggregateType:"reservation",aggregateId:header!.id,
      payload:{reservationId:header!.id,expiresAt:expiresAt.toISOString()},consumers:["storefront:"+p.storefrontId]});
    return {status:200,body:{reservationId:header!.id,status:header!.status,expiresAt:expiresAt.toISOString()}};
  });
}

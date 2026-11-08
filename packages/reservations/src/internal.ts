import { and, eq, inArray, sql } from "drizzle-orm";
import { allocations, bundleComponents, fulfillmentHistory, fulfillmentLines, fulfillmentRequests, reservationExpiryJobs, reservationItems, reservationLines, reservations, scanTasks, storefronts, type DbExecutor } from "@khidi/db";
import { acquireDomainLocks, IDENTITY_CATALOG_LOCK, INVENTORY_CONFIGURATION_LOCK, priceLockKey } from "@khidi/domain/locking";
import type { DomainTransactionContext } from "@khidi/domain";
import { applyWorkflowStockMovements, workflowActor, type WorkflowPrincipal } from "@khidi/inventory/workflow";
import type { StockMovement } from "@khidi/inventory";
import { getSkuReserveEligibility } from "@khidi/publishing";
import { emitInstallmentExpiryNotice } from "@khidi/notifications/deadlines";
import { AppError, createUuidV7 } from "@khidi/shared";
import { isCod, type Confirmation, type ReserveInput } from "./contracts.ts";
import { FULFILLMENT_CONFIGURATION_LOCK, readFrozenMode } from "./mode.ts";
import { assertBundleSingleOwner } from "./bundle-owner.ts";
export { workflowCommand } from "./commands.ts";

export type StorefrontPrincipal=Extract<WorkflowPrincipal,{type:"STOREFRONT_SERVICE"}>;
export type Header=typeof reservations.$inferSelect;
export type Line=typeof reservationLines.$inferSelect;
export function demand(value:unknown,message:string):asserts value {if(!value) throw new AppError("PRECONDITION_FAILED",message);}
export async function databaseNow(tx:DbExecutor) {const r=await tx.execute(sql`SELECT clock_timestamp() AS now`);return new Date((r.rows[0] as {now:string|Date}).now);}

export async function scheduleExpiry(ctx:DomainTransactionContext,header:Header) {
  const [job]=await ctx.tx.insert(reservationExpiryJobs).values({id:createUuidV7(),reservationId:header.id,expiresAt:header.expiresAt}).onConflictDoNothing().returning();
  if(job) await ctx.emitOutboxEvent({eventType:"RESERVATION_JOB_REQUESTED",aggregateType:"reservation",aggregateId:header.id,
    payload:{jobId:job.id,expiresAt:job.expiresAt.toISOString()},consumers:["reservation-jobs"]});
}
export function movement(line:Line,poolId:string,type:StockMovement["type"],quantity:number,requestId?:string):StockMovement {
  return {type,poolId,skuId:line.skuId,allocationId:line.allocationId,reservationId:line.reservationId,reservationLineId:line.id,
    fulfillmentRequestId:requestId,quantity};
}
export async function linePools(tx:DbExecutor,lines:Line[]) {
  const rows=lines.length ? await tx.select().from(allocations).where(inArray(allocations.id,lines.map((l)=>l.allocationId))) : [];
  return new Map(rows.map((a)=>[a.id,a.poolId]));
}
/** Existing workflows serialize on the header, then lock the union before any inner engine call. */
export async function lockReservation(tx:DbExecutor,p:WorkflowPrincipal,id:string,physical:boolean|((h:Header)=>boolean)=false) {
  await acquireDomainLocks(tx,{sharedAdvisoryKeys:[IDENTITY_CATALOG_LOCK,INVENTORY_CONFIGURATION_LOCK]});
  const [header]=await tx.select().from(reservations).where(eq(reservations.id,id)).for("update");
  if(!header || p.type==="STOREFRONT_SERVICE" && header.storefrontId!==p.storefrontId || p.type==="SYSTEM_JOB" && header.id!==p.reservationId)
    throw new AppError("NOT_FOUND","Reservation not found.");
  const lines=await tx.select().from(reservationLines).where(eq(reservationLines.reservationId,id));
  const pools=await linePools(tx,lines);
  const physicalBatch=typeof physical==="function" ? physical(header) : physical;
  if(physicalBatch) {
    await acquireDomainLocks(tx,{skuIds:lines.map((l)=>l.skuId)});
    const all=await tx.select().from(allocations).where(inArray(allocations.skuId,lines.map((l)=>l.skuId)));
    await acquireDomainLocks(tx,{poolBalances:lines.map((l)=>({poolId:pools.get(l.allocationId)!,skuId:l.skuId})),
      allocationIds:all.filter((a)=>lines.some((l)=>l.skuId===a.skuId && pools.get(l.allocationId)===a.poolId)).map((a)=>a.id)});
  } else await acquireDomainLocks(tx,{allocationIds:lines.map((l)=>l.allocationId)});
  return {header,lines,pools};
}
export type LockedReservation=Awaited<ReturnType<typeof lockReservation>>;

export async function reserveInTransaction(ctx:DomainTransactionContext,p:StorefrontPrincipal,input:ReserveInput,key:string) {
  await acquireDomainLocks(ctx.tx,{sharedAdvisoryKeys:[FULFILLMENT_CONFIGURATION_LOCK,IDENTITY_CATALOG_LOCK,INVENTORY_CONFIGURATION_LOCK]});
  const mode=await readFrozenMode(ctx.tx);
  const [store]=await ctx.tx.select().from(storefronts).where(and(eq(storefronts.id,p.storefrontId),eq(storefronts.active,true)));
  demand(store?.availabilityPoolId,"The storefront needs an availability pool.");
  const itemIds=input.items.map((i)=>i.skuId);
  const components=await ctx.tx.select().from(bundleComponents).where(inArray(bundleComponents.bundleSkuId,itemIds));
  const ids=[...new Set([...itemIds,...components.map((c)=>c.componentSkuId)])];
  const auto=isCod(input.paymentMethod) && mode==="SIMPLIFIED_FULFILLMENT";
  await acquireDomainLocks(ctx.tx,{advisoryKeys:itemIds.map(priceLockKey),skuIds:ids});
  const allAllocations=await ctx.tx.select().from(allocations).where(and(eq(allocations.poolId,store.availabilityPoolId),inArray(allocations.skuId,ids)));
  await acquireDomainLocks(ctx.tx,auto ? {poolBalances:ids.map((skuId)=>({poolId:store.availabilityPoolId!,skuId})),allocationIds:allAllocations.map((a)=>a.id)} :
    {allocationIds:allAllocations.filter((a)=>a.storefrontId===store.id).map((a)=>a.id)});
  const now=await databaseNow(ctx.tx),timeout=store.reservationPolicyJson[input.paymentMethod];
  demand(Number.isInteger(timeout) && timeout>0,"Invalid reservation timeout.");
  const [header]=await ctx.tx.insert(reservations).values({id:createUuidV7(),storefrontId:store.id,storefrontOrderRef:input.storefrontOrderRef,
    paymentMethod:input.paymentMethod,fulfillmentMode:mode,expiresAt:new Date(now.getTime()+timeout*1000),createdByApiKeyId:p.apiKeyId,idempotencyKey:key}).returning();
  const lines:Line[]=[];
  for(const requested of input.items) {
    const facts=await getSkuReserveEligibility(ctx.tx,{skuId:requested.skuId,storefrontId:store.id,locale:input.locale??"ka"});
    demand(facts.sellable && facts.price,"The product cannot be reserved: "+facts.blockingReasons.join(", "));
    demand(facts.stock.availableToSell>=requested.quantity,"Insufficient available stock.");
    assertBundleSingleOwner(facts.stock.composedBundle,facts.stock.components);
    const [item]=await ctx.tx.insert(reservationItems).values({id:createUuidV7(),reservationId:header!.id,skuId:requested.skuId,quantity:requested.quantity,
      composedBundle:facts.stock.composedBundle,basePriceMinor:facts.price.basePriceMinor!,currency:facts.price.currency,
      basePriceId:facts.price.id,vatIncluded:facts.price.vatIncluded}).returning();
    for(const component of facts.stock.components) {
      demand(component.allocationId && component.sellerMapping && component.ownerMapping,"Missing component allocation or mapping.");
      const quantity=requested.quantity*component.componentQuantity;
      demand(Number.isSafeInteger(quantity) && quantity<=2_147_483_647,"Component quantity overflow.");
      const [line]=await ctx.tx.insert(reservationLines).values({id:createUuidV7(),reservationId:header!.id,itemId:item!.id,skuId:component.skuId,allocationId:component.allocationId,
        parentBundleSkuId:facts.stock.composedBundle ? requested.skuId : null,quantity,
        sellerMappingId:component.sellerMapping.id,sellerAccountingItemId:component.sellerMapping.accountingItemId,sellerAccountingName:component.sellerMapping.accountingName,
        ownerMappingId:component.ownerMapping.id,ownerAccountingItemId:component.ownerMapping.accountingItemId,ownerAccountingName:component.ownerMapping.accountingName}).returning();
      lines.push(line!);
    }
  }
  const pools=await linePools(ctx.tx,lines);
  await applyWorkflowStockMovements(ctx.tx,p,lines.map((line)=>({...movement(line,pools.get(line.allocationId)!,"RESERVE",line.quantity),paymentMethod:input.paymentMethod})));
  await scheduleExpiry(ctx,header!);
  await emitInstallmentExpiryNotice(ctx,header!);
  await ctx.recordAudit({action:"RESERVATION_CREATED",entityType:"reservation",entityId:header!.id,after:{...header,lines}});
  await ctx.emitOutboxEvent({eventType:"RESERVATION_CREATED",storefrontId:store.id,aggregateType:"reservation",aggregateId:header!.id,
    payload:{reservationId:header!.id,orderRef:header!.storefrontOrderRef,status:"RESERVED",expiresAt:header!.expiresAt.toISOString()},consumers:["storefront:"+store.id]});
  return {header:header!,lines,pools};
}

export async function recordFinalPrices(ctx:DomainTransactionContext,state:LockedReservation,confirmation:Confirmation) {
  const items=await ctx.tx.select().from(reservationItems).where(eq(reservationItems.reservationId,state.header.id));
  demand(confirmation.prices.length===items.length && new Set(confirmation.prices.map((p)=>p.skuId)).size===items.length,"Final prices must cover every original cart item exactly once.");
  for(const item of items) {
    const price=confirmation.prices.find((p)=>p.skuId===item.skuId);
    demand(price && price.currency===item.currency,"Missing or mismatched final cart price.");
    demand(item.finalUnitPriceMinor===null,"The order was already confirmed.");
    await ctx.tx.update(reservationItems).set({finalUnitPriceMinor:price.finalUnitPriceMinor}).where(eq(reservationItems.id,item.id));
  }
}
export async function commitInTransaction(ctx:DomainTransactionContext,p:WorkflowPrincipal,state:LockedReservation) {
  demand(state.header.status==="RESERVED","Only an active reservation can be committed.");
  await applyWorkflowStockMovements(ctx.tx,p,state.lines.map((line)=>movement(line,state.pools.get(line.allocationId)!,"COMMIT",line.quantity)));
  const [header]=await ctx.tx.update(reservations).set({status:"COMMITTED",committedAt:await databaseNow(ctx.tx),updatedAt:new Date()}).where(eq(reservations.id,state.header.id)).returning();
  state.header=header!;
  await ctx.recordAudit({action:"RESERVATION_COMMITTED",entityType:"reservation",entityId:header!.id,after:{status:header!.status}});
  await ctx.emitOutboxEvent({eventType:"STOCK_COMMITTED",storefrontId:header!.storefrontId,aggregateType:"reservation",aggregateId:header!.id,
    payload:{reservationId:header!.id,status:header!.status},consumers:["storefront:"+header!.storefrontId]});
}
export async function releaseQuantities(ctx:DomainTransactionContext,p:WorkflowPrincipal,state:LockedReservation,amounts:Map<string,number>,requestId?:string) {
  const movements=state.lines.flatMap((line)=>{const quantity=amounts.get(line.id)??0;return quantity>0 ? [movement(line,state.pools.get(line.allocationId)!,state.header.status==="COMMITTED" ? "COMMIT_RELEASE" : "RESERVATION_RELEASE",quantity,requestId)] : [];});
  if(movements.length) await applyWorkflowStockMovements(ctx.tx,p,movements);
  if(movements.length && state.header.status==="COMMITTED") await ctx.emitOutboxEvent({eventType:"COMMIT_RELEASED",storefrontId:state.header.storefrontId,
    aggregateType:"reservation",aggregateId:state.header.id,payload:{reservationId:state.header.id},consumers:["storefront:"+state.header.storefrontId]});
  for(const line of state.lines) {
    const quantity=amounts.get(line.id)??0;
    if(quantity) {line.releasedQuantity+=quantity;await ctx.tx.update(reservationLines).set({releasedQuantity:line.releasedQuantity}).where(eq(reservationLines.id,line.id));}
  }
}
export async function closeRelease(ctx:DomainTransactionContext,state:LockedReservation,status:"EXPIRED"|"RELEASED",reason:string) {
  await ctx.tx.update(reservations).set({status,releasedAt:await databaseNow(ctx.tx),releaseReason:reason,updatedAt:new Date()}).where(eq(reservations.id,state.header.id));
  await ctx.recordAudit({action:"RESERVATION_"+status,entityType:"reservation",entityId:state.header.id,after:{status},reason});
  await ctx.emitOutboxEvent({eventType:status==="EXPIRED" ? "RESERVATION_EXPIRED" : "RESERVATION_UPDATED",storefrontId:state.header.storefrontId,
    aggregateType:"reservation",aggregateId:state.header.id,payload:{reservationId:state.header.id,status},consumers:["storefront:"+state.header.storefrontId]});
}
export async function expireLocked(ctx:DomainTransactionContext,p:WorkflowPrincipal,state:LockedReservation) {
  if(state.header.status!=="RESERVED" || state.header.expiresAt>await databaseNow(ctx.tx)) return false;
  const [request]=await ctx.tx.select().from(fulfillmentRequests).where(eq(fulfillmentRequests.reservationId,state.header.id));
  const staged=request ? await ctx.tx.select().from(fulfillmentLines).where(eq(fulfillmentLines.fulfillmentRequestId,request.id)) : [];
  const held=staged.some((l)=>l.pickedQuantity>l.returnedQuantity+l.lostQuantity+l.handedOverQuantity);
  if(held) {
    await ctx.tx.update(fulfillmentRequests).set({status:"ACTION_REQUIRED"}).where(eq(fulfillmentRequests.id,request!.id));
    await ctx.recordAudit({action:"FULFILLMENT_EXPIRY_HELD",entityType:"fulfillment_request",entityId:request!.id,after:{status:"ACTION_REQUIRED"}});
    await ctx.emitOutboxEvent({eventType:"FULFILLMENT_STATUS_CHANGED",storefrontId:state.header.storefrontId,aggregateType:"fulfillment_request",aggregateId:request!.id,
      payload:{schemaVersion:1,reservationId:state.header.id,fulfillmentRequestId:request!.id,status:"ACTION_REQUIRED",reason:"EXPIRED_WITH_STAGED_UNITS"},consumers:["notifications","storefront:"+state.header.storefrontId]});
  } else {
    await releaseQuantities(ctx,p,state,new Map(state.lines.map((l)=>[l.id,l.quantity-l.releasedQuantity])),request?.id);
    await closeRelease(ctx,state,"EXPIRED","RESERVATION_TIMEOUT");
    if(request) {
      await ctx.tx.update(fulfillmentRequests).set({status:"CANCELLED",cancelReason:"RESERVATION_TIMEOUT",cancelledAt:new Date()}).where(eq(fulfillmentRequests.id,request.id));
      await ctx.tx.update(scanTasks).set({status:"CANCELLED"}).where(eq(scanTasks.fulfillmentRequestId,request.id));
      await ctx.emitOutboxEvent({eventType:"FULFILLMENT_STATUS_CHANGED",storefrontId:state.header.storefrontId,aggregateType:"fulfillment_request",aggregateId:request.id,
        payload:{schemaVersion:1,reservationId:state.header.id,fulfillmentRequestId:request.id,status:"CANCELLED",reason:"RESERVATION_TIMEOUT"},consumers:["storefront:"+state.header.storefrontId]});
    }
  }
  if(request) {
    const actor=workflowActor(p);
    await ctx.tx.insert(fulfillmentHistory).values({id:createUuidV7(),fulfillmentRequestId:request.id,fromStatus:request.status,
      toStatus:held ? "ACTION_REQUIRED" : "CANCELLED",action:"FULFILLMENT_EXPIRED",actorType:p.type,actorId:actor.principalId!,reason:"RESERVATION_TIMEOUT"});
  }
  return true;
}

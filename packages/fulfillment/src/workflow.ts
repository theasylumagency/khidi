import { and, eq } from "drizzle-orm";
import { fulfillmentHistory, fulfillmentLines, fulfillmentRequests, reservations, scanTasks, unitConfirmations, users, type DbExecutor } from "@khidi/db";
import { withDomainTransaction, type DomainTransactionContext } from "@khidi/domain";
import { applyWorkflowStockMovements, workflowActor, type WorkflowPrincipal } from "@khidi/inventory/workflow";
import type { StockMovement } from "@khidi/inventory";
import { commitSchema, isCod, parseInput, releaseSchema, reserveSchema, type Confirmation, type OrderResponse, type StorefrontPrincipal } from "@khidi/reservations";
import { closeRelease, commitInTransaction, databaseNow, demand, expireLocked, lockReservation, movement, recordFinalPrices, releaseQuantities, reserveInTransaction,
  workflowCommand, type LockedReservation } from "@khidi/reservations/internal";
import { normalizeScan, resolveScanIdentity } from "@khidi/scanning";
import { AppError, createUuidV7 } from "@khidi/shared";
import { z } from "zod";

type Request=typeof fulfillmentRequests.$inferSelect;
type RequestLine=typeof fulfillmentLines.$inferSelect;
type Staff=Extract<WorkflowPrincipal,{type:"USER"}>;
type Provenance="SCAN"|"MANUAL"|"AUTO_ASSUMED";
const staged=(l:RequestLine)=>l.pickedQuantity-l.returnedQuantity-l.lostQuantity-l.handedOverQuantity;

async function history(ctx:DomainTransactionContext,p:WorkflowPrincipal,request:Request,toStatus:string,action:string,confirmation?:Provenance,reason?:string) {
  const actor=workflowActor(p);
  await ctx.tx.insert(fulfillmentHistory).values({id:createUuidV7(),fulfillmentRequestId:request.id,fromStatus:request.status,toStatus,action,
    confirmation,actorType:p.type,actorId:actor.principalId!,triggerApiKeyId:actor.triggerApiKeyId,triggerCallId:actor.triggerCallId,reason});
  await ctx.recordAudit({action,entityType:"fulfillment_request",entityId:request.id,before:{status:request.status},after:{status:toStatus,confirmation},reason});
  await ctx.emitOutboxEvent({eventType:"FULFILLMENT_STATUS_CHANGED",storefrontId:request.storefrontId,aggregateType:"fulfillment_request",aggregateId:request.id,
    payload:{schemaVersion:1,fulfillmentRequestId:request.id,reservationId:request.reservationId,orderRef:request.storefrontOrderRef,status:toStatus,
      ...(confirmation ? {confirmation} : {}),...(reason?.startsWith("UNIT_LOST:") ? {reason:"UNIT_LOST"} : {})},consumers:["storefront:"+request.storefrontId]});
}
async function createFulfillment(ctx:DomainTransactionContext,p:StorefrontPrincipal,state:LockedReservation,confirmation:Confirmation) {
  const [existing]=await ctx.tx.select().from(fulfillmentRequests).where(eq(fulfillmentRequests.reservationId,state.header.id));
  demand(!existing,"A reservation already has its complete fulfillment request.");
  await recordFinalPrices(ctx,state,confirmation);
  const [request]=await ctx.tx.insert(fulfillmentRequests).values({id:createUuidV7(),reservationId:state.header.id,storefrontId:state.header.storefrontId,
    storefrontOrderRef:state.header.storefrontOrderRef,deliveryMethod:confirmation.deliveryMethod,shipBy:confirmation.shipBy}).returning();
  const lines=await ctx.tx.insert(fulfillmentLines).values(state.lines.map((line)=>({id:createUuidV7(),fulfillmentRequestId:request!.id,
    reservationId:state.header.id,reservationLineId:line.id,skuId:line.skuId,parentBundleSkuId:line.parentBundleSkuId,allocationId:line.allocationId,quantity:line.quantity}))).returning();
  await history(ctx,p,request!,"REQUESTED","FULFILLMENT_REQUESTED");
  if(state.header.fulfillmentMode==="CONTROLLED_FULFILLMENT") {
    await ctx.tx.insert(scanTasks).values({id:createUuidV7(),taskType:"PICK",title:"Khidi",assigneeRole:"WAREHOUSE",fulfillmentRequestId:request!.id,
      photosRequired:false,createdByApiKeyId:p.apiKeyId,targetCount:lines.reduce((n,l)=>n+l.quantity,0)});
    await ctx.emitOutboxEvent({eventType:"SCAN_TASK_CREATED",aggregateType:"fulfillment_request",aggregateId:request!.id,payload:{fulfillmentRequestId:request!.id},consumers:["notifications"]});
  }
  return {request:request!,lines};
}
async function autoComplete(ctx:DomainTransactionContext,trigger:StorefrontPrincipal,callId:string,state:LockedReservation,request:Request,lines:RequestLine[]) {
  const p:WorkflowPrincipal={type:"SYSTEM_WORKFLOW",policy:"SIMPLIFIED_FULFILLMENT",reservationId:state.header.id,storefrontId:trigger.storefrontId,triggerApiKeyId:trigger.apiKeyId,triggerCallId:callId};
  return withDomainTransaction(ctx.tx,{...workflowActor(p),correlationId:ctx.correlationId},async(system)=>{
    const batch:StockMovement[]=[];
    if(!isCod(state.header.paymentMethod)) for(const line of state.lines) batch.push(movement(line,state.pools.get(line.allocationId)!,"COMMIT",line.quantity,request.id));
    for(const line of state.lines) {
      const id=createUuidV7();
      await system.tx.insert(unitConfirmations).values({id,reservationId:state.header.id,fulfillmentRequestId:request.id,reservationLineId:line.id,
        skuId:line.skuId,allocationId:line.allocationId,action:"PICK_TO_STAGING",method:"AUTO_ASSUMED",quantity:line.quantity,
        triggerApiKeyId:trigger.apiKeyId,triggerCallId:callId});
      batch.push({...movement(line,state.pools.get(line.allocationId)!,"PICK_TO_STAGING",line.quantity,request.id),unitConfirmationIds:[id]});
    }
    for(const line of state.lines) {
      if(isCod(state.header.paymentMethod)) batch.push(movement(line,state.pools.get(line.allocationId)!,"COMMIT",line.quantity,request.id));
      batch.push(movement(line,state.pools.get(line.allocationId)!,"HANDOVER_OUT",line.quantity,request.id));
    }
    await applyWorkflowStockMovements(system.tx,p,batch);
    await system.emitOutboxEvent({eventType:"STOCK_COMMITTED",storefrontId:state.header.storefrontId,aggregateType:"reservation",aggregateId:state.header.id,
      payload:{reservationId:state.header.id,status:"HANDED_OVER",confirmation:"AUTO_ASSUMED"},consumers:["storefront:"+state.header.storefrontId]});
    for(const line of lines) await system.tx.update(fulfillmentLines).set({pickedQuantity:line.quantity,handedOverQuantity:line.quantity}).where(eq(fulfillmentLines.id,line.id));
    await history(system,p,request,"REQUESTED","ORDER_COMMITTED","AUTO_ASSUMED");
    await history(system,p,request,"PICKED","FULFILLMENT_PICKED","AUTO_ASSUMED");
    await history(system,p,{...request,status:"PICKED"},"HANDED_OVER","FULFILLMENT_HANDED_OVER","AUTO_ASSUMED");
    const now=await databaseNow(system.tx);
    await system.tx.update(fulfillmentRequests).set({status:"HANDED_OVER",pickedAt:now,handedOverAt:now}).where(eq(fulfillmentRequests.id,request.id));
    await system.tx.update(reservations).set({status:"HANDED_OVER",committedAt:now,handedOverAt:now,updatedAt:now}).where(eq(reservations.id,state.header.id));
    return {reservationId:state.header.id,fulfillmentRequestId:request.id,status:"HANDED_OVER",confirmation:"AUTO_ASSUMED"} satisfies OrderResponse;
  });
}

/** Public order-confirmation facade: transport never chooses a mode or a ledger principal. */
export async function reserveOrder(db:DbExecutor,p:StorefrontPrincipal,key:string,raw:unknown) {
  const input=parseInput(reserveSchema,raw);
  return workflowCommand<OrderResponse>(db,p,"reserve",key,input,async(ctx)=>{
    const state=await reserveInTransaction(ctx,p,input,key);
    if(!isCod(input.paymentMethod)) return {status:201,body:{reservationId:state.header.id,status:"RESERVED",expiresAt:state.header.expiresAt.toISOString()}};
    const {request,lines}=await createFulfillment(ctx,p,state,input.confirmation!);
    const body=state.header.fulfillmentMode==="SIMPLIFIED_FULFILLMENT" ? await autoComplete(ctx,p,key,state,request,lines) :
      {reservationId:state.header.id,fulfillmentRequestId:request.id,status:"REQUESTED"};
    return {status:201,body};
  });
}
export async function confirmOrder(db:DbExecutor,p:StorefrontPrincipal,key:string,raw:unknown) {
  const input=parseInput(commitSchema,raw);
  return workflowCommand<OrderResponse>(db,p,"confirm",key,input,async(ctx)=>{
    const state=await lockReservation(ctx.tx,p,input.reservationId,(h)=>h.fulfillmentMode==="SIMPLIFIED_FULFILLMENT");
    if(state.header.status==="EXPIRED" || await expireLocked(ctx,p,state)) return {status:409,body:{code:"RESERVATION_EXPIRED"}};
    demand(state.header.status==="RESERVED" && !isCod(state.header.paymentMethod),"This order cannot be confirmed again.");
    const {request,lines}=await createFulfillment(ctx,p,state,input.confirmation);
    if(state.header.fulfillmentMode==="SIMPLIFIED_FULFILLMENT") return {status:200,body:await autoComplete(ctx,p,key,state,request,lines)};
    await commitInTransaction(ctx,p,state);
    return {status:200,body:{reservationId:state.header.id,fulfillmentRequestId:request.id,status:"REQUESTED"}};
  });
}

async function requestState(ctx:DomainTransactionContext,p:Staff,requestId:string) {
  const [request]=await ctx.tx.select().from(fulfillmentRequests).where(eq(fulfillmentRequests.id,requestId));
  if(!request) throw new AppError("NOT_FOUND","Fulfillment request not found.");
  const state=await lockReservation(ctx.tx,p,request.reservationId,true);
  demand(state.header.fulfillmentMode==="CONTROLLED_FULFILLMENT" && state.header.status!=="HANDED_OVER","This order is closed for stock changes.");
  const [current]=await ctx.tx.select().from(fulfillmentRequests).where(eq(fulfillmentRequests.id,requestId));
  const lines=await ctx.tx.select().from(fulfillmentLines).where(eq(fulfillmentLines.fulfillmentRequestId,requestId));
  return {state,request:current!,lines};
}
const unitSchema=z.object({fulfillmentRequestId:z.string().uuid(),lineId:z.string().uuid(),action:z.enum(["PICK","RETURN"]),
  confirmation:z.discriminatedUnion("method",[
    z.object({method:z.literal("SCAN"),identifier:z.string().trim().min(1).max(200)}).strict(),
    z.object({method:z.literal("MANUAL"),reason:z.string().trim().min(1).max(1000)}).strict()
  ])}).strict();
async function staffRole(tx:DbExecutor,p:Staff,roles:string[]) {
  const [user]=await tx.select().from(users).where(and(eq(users.id,p.userId),eq(users.active,true)));
  if(!user || !roles.includes(user.role)) throw new AppError("FORBIDDEN","This staff action is not permitted.");
}
export async function confirmFulfillmentUnit(db:DbExecutor,p:Staff,key:string,raw:unknown) {
  const input=parseInput(unitSchema,raw);
  return workflowCommand<OrderResponse>(db,p,"unit",key,input,async(ctx)=>{
    const {state,request,lines}=await requestState(ctx,p,input.fulfillmentRequestId);
    const line=lines.find((l)=>l.id===input.lineId),snapshot=state.lines.find((l)=>l.id===line?.reservationLineId);
    demand(line && snapshot,"Fulfillment line not found.");
    if(input.confirmation.method==="MANUAL") await staffRole(ctx.tx,p,["ADMIN","ORDER_MANAGER"]);
    if(input.action==="PICK") demand(["REQUESTED","PICKING"].includes(request.status) && line.pickedQuantity<line.quantity,"This unit cannot be picked.");
    else demand((request.status==="CANCELLED" || request.status==="ACTION_REQUIRED") && staged(line)>0,"Only staged units awaiting return can be returned.");
    if(input.confirmation.method==="SCAN") {
      const identity=await resolveScanIdentity(ctx.tx,ctx.actor,normalizeScan(input.confirmation.identifier),{allowCreate:false});
      demand(identity.skuId===line.skuId,"The scanned identifier belongs to another SKU or requires review.");
    }
    const action=input.action==="PICK" ? "PICK_TO_STAGING" : "RETURN_TO_SHELF",id=createUuidV7();
    await ctx.tx.insert(unitConfirmations).values({id,reservationId:state.header.id,fulfillmentRequestId:request.id,reservationLineId:snapshot.id,
      skuId:line.skuId,allocationId:line.allocationId,action,method:input.confirmation.method,quantity:1,actorUserId:p.userId,
      scannedIdentifier:input.confirmation.method==="SCAN" ? input.confirmation.identifier : null,
      reason:input.confirmation.method==="MANUAL" ? input.confirmation.reason : null});
    await applyWorkflowStockMovements(ctx.tx,p,[{...movement(snapshot,state.pools.get(line.allocationId)!,action,1,request.id),unitConfirmationIds:[id]}]);
    if(input.action==="PICK") line.pickedQuantity++; else line.returnedQuantity++;
    await ctx.tx.update(fulfillmentLines).set({pickedQuantity:line.pickedQuantity,returnedQuantity:line.returnedQuantity}).where(eq(fulfillmentLines.id,line.id));
    let status=request.status;
    if(input.action==="PICK") status=lines.every((l)=>l.pickedQuantity===l.quantity) ? "PICKED" : "PICKING";
    else if(request.requiresReturnToShelf) {
      await releaseQuantities(ctx,p,state,new Map([[snapshot.id,1]]),request.id);
      const pending=lines.some((l)=>staged(l)>0);
      await ctx.tx.update(fulfillmentRequests).set({requiresReturnToShelf:pending}).where(eq(fulfillmentRequests.id,request.id));
      if(!pending) {
        status="CANCELLED";
        await closeRelease(ctx,state,"RELEASED",request.cancelReason??"CANCELLED");
        await ctx.tx.update(scanTasks).set({status:"CANCELLED"}).where(eq(scanTasks.fulfillmentRequestId,request.id));
      }
    }
    await ctx.tx.update(fulfillmentRequests).set({status,...(status==="PICKED" ? {pickedAt:new Date()} : {})}).where(eq(fulfillmentRequests.id,request.id));
    await history(ctx,p,request,status,input.action==="PICK" ? "FULFILLMENT_UNIT_PICKED" : "FULFILLMENT_UNIT_RETURNED",input.confirmation.method,
      input.confirmation.method==="MANUAL" ? input.confirmation.reason : undefined);
    return {status:200,body:{fulfillmentRequestId:request.id,reservationId:state.header.id,status,confirmation:input.confirmation.method}};
  });
}

const requestSchema=z.object({fulfillmentRequestId:z.string().uuid()}).strict();
export async function handoverOrder(db:DbExecutor,p:Staff,key:string,raw:unknown) {
  const input=parseInput(requestSchema,raw);
  return workflowCommand<OrderResponse>(db,p,"handover",key,input,async(ctx)=>{
    const {state,request,lines}=await requestState(ctx,p,input.fulfillmentRequestId);
    demand(request.status==="PICKED" && lines.every((l)=>staged(l)===l.quantity),"Every line must be picked before full handover.");
    const batch=state.lines.flatMap((line)=>{
      const handover=movement(line,state.pools.get(line.allocationId)!,"HANDOVER_OUT",line.quantity,request.id);
      return isCod(state.header.paymentMethod) ? [movement(line,state.pools.get(line.allocationId)!,"COMMIT",line.quantity,request.id),handover] : [handover];
    });
    await applyWorkflowStockMovements(ctx.tx,p,batch);
    if(isCod(state.header.paymentMethod)) await ctx.emitOutboxEvent({eventType:"STOCK_COMMITTED",storefrontId:state.header.storefrontId,aggregateType:"reservation",aggregateId:state.header.id,
      payload:{reservationId:state.header.id,status:"HANDED_OVER"},consumers:["storefront:"+state.header.storefrontId]});
    for(const line of lines) await ctx.tx.update(fulfillmentLines).set({handedOverQuantity:line.quantity}).where(eq(fulfillmentLines.id,line.id));
    const confirmations=await ctx.tx.select().from(unitConfirmations).where(and(eq(unitConfirmations.fulfillmentRequestId,request.id),eq(unitConfirmations.action,"PICK_TO_STAGING")));
    const confirmation:Provenance=confirmations.some((c)=>c.method==="MANUAL") ? "MANUAL" : "SCAN";
    await history(ctx,p,request,"HANDED_OVER","FULFILLMENT_HANDED_OVER",confirmation);
    const now=await databaseNow(ctx.tx);
    await ctx.tx.update(fulfillmentRequests).set({status:"HANDED_OVER",handedOverAt:now}).where(eq(fulfillmentRequests.id,request.id));
    await ctx.tx.update(reservations).set({status:"HANDED_OVER",committedAt:state.header.committedAt??now,handedOverAt:now,updatedAt:now}).where(eq(reservations.id,state.header.id));
    await ctx.tx.update(scanTasks).set({status:"COMPLETED",completedAt:now}).where(eq(scanTasks.fulfillmentRequestId,request.id));
    return {status:200,body:{reservationId:state.header.id,fulfillmentRequestId:request.id,status:"HANDED_OVER",confirmation}};
  });
}

export async function cancelLocked(ctx:DomainTransactionContext,p:WorkflowPrincipal,state:LockedReservation,reason:string) {
  demand(["RESERVED","COMMITTED"].includes(state.header.status),"This order is already closed.");
  const [request]=await ctx.tx.select().from(fulfillmentRequests).where(eq(fulfillmentRequests.reservationId,state.header.id));
  const lines=request ? await ctx.tx.select().from(fulfillmentLines).where(eq(fulfillmentLines.fulfillmentRequestId,request.id)) : [];
  const amounts=new Map(state.lines.map((l)=>{const physical=lines.find((f)=>f.reservationLineId===l.id);return [l.id,l.quantity-l.releasedQuantity-(physical ? staged(physical)+physical.lostQuantity+physical.handedOverQuantity : 0)];}));
  await releaseQuantities(ctx,p,state,amounts,request?.id);
  const pending=lines.some((l)=>staged(l)>0);
  if(request) {
    await ctx.tx.update(fulfillmentRequests).set({status:"CANCELLED",cancelReason:reason,requiresReturnToShelf:pending,cancelledAt:new Date()}).where(eq(fulfillmentRequests.id,request.id));
    await history(ctx,p,request,"CANCELLED","FULFILLMENT_CANCELLED",undefined,reason);
    if(!pending) await ctx.tx.update(scanTasks).set({status:"CANCELLED"}).where(eq(scanTasks.fulfillmentRequestId,request.id));
  }
  if(!pending) await closeRelease(ctx,state,"RELEASED",reason);
  return {reservationId:state.header.id,...(request ? {fulfillmentRequestId:request.id} : {}),status:request ? "CANCELLED" : "RELEASED",requiresReturnToShelf:pending} satisfies OrderResponse;
}
export async function releaseOrder(db:DbExecutor,p:StorefrontPrincipal,key:string,raw:unknown) {
  const input=parseInput(releaseSchema,raw);
  return workflowCommand<OrderResponse>(db,p,"release",key,input,async(ctx)=>{
    const state=await lockReservation(ctx.tx,p,input.reservationId);
    demand(state.header.status==="RESERVED","This order is closed or committed; cancel its active fulfillment instead.");
    return {status:200,body:await cancelLocked(ctx,p,state,input.reason)};
  });
}
export async function cancelFulfillment(db:DbExecutor,p:Staff,key:string,raw:unknown) {
  const input=parseInput(requestSchema.extend({reason:z.string().trim().min(1).max(1000)}).strict(),raw);
  return workflowCommand<OrderResponse>(db,p,"cancel",key,input,async(ctx)=>{
    await staffRole(ctx.tx,p,["ADMIN","ORDER_MANAGER"]);
    const {state}=await requestState(ctx,p,input.fulfillmentRequestId);
    return {status:200,body:await cancelLocked(ctx,p,state,input.reason)};
  });
}
export async function markLostInStaging(db:DbExecutor,p:Staff,key:string,raw:unknown) {
  const input=parseInput(requestSchema.extend({lineId:z.string().uuid(),reason:z.string().trim().min(1).max(1000)}).strict(),raw);
  return workflowCommand<OrderResponse>(db,p,"lost",key,input,async(ctx)=>{
    await staffRole(ctx.tx,p,["ADMIN"]);
    const {state,request,lines}=await requestState(ctx,p,input.fulfillmentRequestId);
    const line=lines.find((l)=>l.id===input.lineId),snapshot=state.lines.find((l)=>l.id===line?.reservationLineId);
    demand(line && snapshot && staged(line)>0,"No staged unit is available to mark lost.");
    const lost={...movement(snapshot,state.pools.get(line.allocationId)!,"ADJUSTMENT",1,request.id),variant:isCod(state.header.paymentMethod) ? "STAGING_RESERVED" : "STAGING_COMMITTED",cancelLostLine:true,reason:input.reason};
    await applyWorkflowStockMovements(ctx.tx,p,[lost],{cancelLostFulfillmentLine:async(proof)=>{
      await proof.tx.update(fulfillmentLines).set({lostQuantity:line.lostQuantity+1}).where(eq(fulfillmentLines.id,line.id));
      await proof.recordAudit({action:"FULFILLMENT_UNIT_LOST",entityType:"fulfillment_line",entityId:line.id,after:{lostQuantity:line.lostQuantity+1},reason:input.reason});
    }});
    return {status:200,body:await cancelLocked(ctx,p,state,"UNIT_LOST: "+input.reason)};
  });
}

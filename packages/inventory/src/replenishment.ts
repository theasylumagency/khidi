import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { allocationBalances, allocations, inventoryNotifications, replenishmentRequests, stockPools, userEntityMemberships, users, skus, storefronts, type DbExecutor } from "@khidi/db";
import { withDomainTransaction, type DomainActor, type DomainTransactionContext } from "@khidi/domain";
import { acquireDomainLocks } from "@khidi/domain/locking";
import { AppError, createUuidV7 } from "@khidi/shared";
import { inventoryAccess } from "./access.ts";

export function allocationStockStatus(available:number,minimum:number) {
  return available===0 ? "OUT_OF_STOCK" : available<=minimum ? "LOW_STOCK" : "NORMAL";
}
async function allocationContext(db:DbExecutor,actor:DomainActor,id:string) {
  const [row]=await db.select({allocation:allocations,pool:stockPools}).from(allocations).innerJoin(stockPools,eq(stockPools.id,allocations.poolId)).where(eq(allocations.id,id));
  if(!row) throw new AppError("NOT_FOUND","Allocation not found.");
  await inventoryAccess(db,actor,row.pool.ownerEntityId);
  return row;
}
async function openRequest(ctx:DomainTransactionContext,allocationId:string,quantity:number,note?:string) {
  const [existing]=await ctx.tx.select().from(replenishmentRequests).where(and(eq(replenishmentRequests.allocationId,allocationId),inArray(replenishmentRequests.status,["OPEN","ACKNOWLEDGED"])));
  if(existing) return existing;
  const [request]=await ctx.tx.insert(replenishmentRequests).values({id:createUuidV7(),allocationId,requestedQuantity:quantity,status:"OPEN",createdBy:ctx.actor.userId,note}).returning();
  await ctx.recordAudit({action:"REPLENISHMENT_REQUESTED",entityType:"replenishment_request",entityId:request!.id,after:request});
  await ctx.emitOutboxEvent({eventType:"REPLENISHMENT_CHANGED",aggregateType:"allocation",aggregateId:allocationId,payload:{requestId:request!.id,status:"OPEN"},consumers:["notifications"]});
  return request!;
}
/** Caller holds the allocation balance lock. Notifications record state transitions, not decrements. */
export async function refreshAllocationStockStatus(ctx:DomainTransactionContext,allocationId:string) {
  const [row]=await ctx.tx.select({allocation:allocations,balance:allocationBalances,pool:stockPools}).from(allocations)
    .innerJoin(stockPools,eq(stockPools.id,allocations.poolId)).innerJoin(allocationBalances,eq(allocationBalances.allocationId,allocations.id)).where(eq(allocations.id,allocationId));
  if(!row) return;
  const next=allocationStockStatus(row.balance.availableToSell,row.allocation.minimumStock);
  if(next===row.allocation.alertState) return;
  await ctx.tx.update(allocations).set({alertState:next}).where(eq(allocations.id,allocationId));
  const recipients=await ctx.tx.select({id:users.id}).from(users).innerJoin(userEntityMemberships,eq(userEntityMemberships.userId,users.id))
    .where(and(eq(users.active,true),eq(userEntityMemberships.legalEntityId,row.pool.ownerEntityId),or(eq(users.role,"STOCK_MANAGER"),eq(userEntityMemberships.isStockManagerRecipient,true))));
  const [notification]=await ctx.tx.insert(inventoryNotifications).values({id:createUuidV7(),allocationId,status:next,availableToSell:row.balance.availableToSell,ownerEntityId:row.pool.ownerEntityId,recipientUserIds:recipients.map((r)=>r.id)}).returning();
  await ctx.recordAudit({action:"STOCK_STATUS_CHANGED",entityType:"allocation",entityId:allocationId,before:{status:row.allocation.alertState},after:{status:next,availableToSell:row.balance.availableToSell}});
  await ctx.emitOutboxEvent({eventType:next==="NORMAL"?"STOCK_RECOVERED":next==="LOW_STOCK"?"STOCK_LOW":"STOCK_OUT",storefrontId:row.allocation.storefrontId,aggregateType:"allocation",aggregateId:allocationId,
    payload:{notificationId:notification!.id,status:next,availableToSell:row.balance.availableToSell,recipientUserIds:recipients.map((r)=>r.id)},consumers:["notifications"]});
  if(next!=="NORMAL") await openRequest(ctx,allocationId,Math.max(1,row.allocation.minimumStock+1-row.balance.availableToSell));
}
export async function setAllocationMinimum(db:DbExecutor,actor:DomainActor,raw:{allocationId:string;minimum:number}) {
  const parsed=z.object({allocationId:z.string().uuid(),minimum:z.number().int().min(0).max(2_147_483_646)}).strict().safeParse(raw);
  if(!parsed.success) throw new AppError("VALIDATION_ERROR","Invalid stock minimum.");
  return withDomainTransaction(db,actor,async(ctx)=>{
    await allocationContext(ctx.tx,actor,parsed.data.allocationId);
    await acquireDomainLocks(ctx.tx,{allocationIds:[parsed.data.allocationId]});
    const [before]=await ctx.tx.select().from(allocations).where(eq(allocations.id,parsed.data.allocationId));
    await ctx.tx.update(allocations).set({minimumStock:parsed.data.minimum}).where(eq(allocations.id,parsed.data.allocationId));
    await ctx.recordAudit({action:"ALLOCATION_MINIMUM_CHANGED",entityType:"allocation",entityId:parsed.data.allocationId,before:{minimumStock:before!.minimumStock},after:{minimumStock:parsed.data.minimum}});
    await ctx.emitOutboxEvent({eventType:"INVENTORY_CONFIGURED",aggregateType:"allocation",aggregateId:parsed.data.allocationId,payload:{minimumStock:parsed.data.minimum},consumers:[]});
    await refreshAllocationStockStatus(ctx,parsed.data.allocationId);
    return {allocationId:parsed.data.allocationId,minimum:parsed.data.minimum};
  });
}
export async function requestReplenishment(db:DbExecutor,actor:DomainActor,raw:{allocationId:string;quantity:number;note?:string}) {
  const parsed=z.object({allocationId:z.string().uuid(),quantity:z.number().int().positive().max(2_147_483_647),note:z.string().trim().max(1000).optional()}).strict().safeParse(raw);
  if(!parsed.success) throw new AppError("VALIDATION_ERROR","Invalid replenishment request.");
  return withDomainTransaction(db,actor,async(ctx)=>{
    await allocationContext(ctx.tx,actor,parsed.data.allocationId);
    await acquireDomainLocks(ctx.tx,{allocationIds:[parsed.data.allocationId]});
    return openRequest(ctx,parsed.data.allocationId,parsed.data.quantity,parsed.data.note);
  });
}
export async function respondToReplenishment(db:DbExecutor,actor:DomainActor,raw:{requestId:string;status:"ACKNOWLEDGED"|"DECLINED";note?:string}) {
  const parsed=z.object({requestId:z.string().uuid(),status:z.enum(["ACKNOWLEDGED","DECLINED"]),note:z.string().trim().max(1000).optional()}).strict().safeParse(raw);
  if(!parsed.success) throw new AppError("VALIDATION_ERROR","Invalid replenishment response.");
  return withDomainTransaction(db,actor,async(ctx)=>{
    const [initial]=await ctx.tx.select().from(replenishmentRequests).where(eq(replenishmentRequests.id,parsed.data.requestId));
    if(!initial) throw new AppError("NOT_FOUND","Request not found.");
    await allocationContext(ctx.tx,actor,initial.allocationId);
    await acquireDomainLocks(ctx.tx,{allocationIds:[initial.allocationId]});
    const [current]=await ctx.tx.select().from(replenishmentRequests).where(eq(replenishmentRequests.id,initial.id)).for("update");
    if(!["OPEN","ACKNOWLEDGED"].includes(current!.status) || parsed.data.status==="ACKNOWLEDGED" && current!.status!=="OPEN") throw new AppError("PRECONDITION_FAILED","Request is no longer open.");
    const [updated]=await ctx.tx.update(replenishmentRequests).set({status:parsed.data.status,note:parsed.data.note??current!.note,updatedBy:actor.userId,updatedAt:new Date()}).where(eq(replenishmentRequests.id,current!.id)).returning();
    await ctx.recordAudit({action:"REPLENISHMENT_RESPONDED",entityType:"replenishment_request",entityId:current!.id,before:current,after:updated});
    await ctx.emitOutboxEvent({eventType:"REPLENISHMENT_CHANGED",aggregateType:"allocation",aggregateId:initial.allocationId,payload:{requestId:initial.id,status:parsed.data.status},consumers:["notifications"]});
    return updated!;
  });
}
export async function listInventoryActions(db:DbExecutor,actor:DomainActor) {
  const {user,ownerIds}=await inventoryAccess(db,actor);
  const visible=user.role==="ADMIN"?undefined:inArray(stockPools.ownerEntityId,ownerIds);
  const requests=await db.select({request:replenishmentRequests,allocation:allocations,ownerEntityId:stockPools.ownerEntityId,storeName:storefronts.name,code:skus.internalSku,name:skus.displayNameKa}).from(replenishmentRequests)
    .innerJoin(allocations,eq(allocations.id,replenishmentRequests.allocationId)).innerJoin(stockPools,eq(stockPools.id,allocations.poolId)).innerJoin(skus,eq(skus.id,allocations.skuId)).innerJoin(storefronts,eq(storefronts.id,allocations.storefrontId))
    .where(visible).orderBy(desc(replenishmentRequests.createdAt)).limit(100);
  const notifications=await db.select({notification:inventoryNotifications,code:skus.internalSku,storeName:storefronts.name}).from(inventoryNotifications)
    .innerJoin(allocations,eq(allocations.id,inventoryNotifications.allocationId)).innerJoin(stockPools,eq(stockPools.id,allocations.poolId)).innerJoin(skus,eq(skus.id,allocations.skuId)).innerJoin(storefronts,eq(storefronts.id,allocations.storefrontId))
    .where(visible).orderBy(desc(inventoryNotifications.createdAt)).limit(50);
  return {requests,notifications};
}

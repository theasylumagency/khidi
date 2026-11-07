import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { allocationBalances, allocations, poolSkuBalances, replenishmentRequests, skus, stockPools, storefronts, type DbExecutor } from "@khidi/db";
import { executeIdempotent, withDomainTransaction, type DomainActor } from "@khidi/domain";
import { acquireDomainLocks, INVENTORY_CONFIGURATION_LOCK } from "@khidi/domain/locking";
import { getActiveEntityRelationship } from "@khidi/entities";
import { AppError, createUuidV7 } from "@khidi/shared";
import { inventoryAccess, relationshipInventoryKey, storefrontInventoryKey } from "./access.ts";
import { applyStockMovements } from "./engine.ts";
import type { StockMovement } from "./types.ts";
import { refreshAllocationStockStatus } from "./replenishment.ts";

const targetSchema=z.object({skuId:z.string().uuid(),storefrontId:z.string().uuid(),target:z.number().int().min(0).max(2_147_483_647),replenishmentRequestId:z.string().uuid().optional()}).strict();
const setSchema=targetSchema.extend({idempotencyKey:z.string().uuid()});
export type AvailabilityTarget=z.infer<typeof targetSchema>;
export type SetAvailabilityInput=z.infer<typeof setSchema>;
function parse<T>(schema:z.ZodType<T>,input:unknown):T {const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError("VALIDATION_ERROR","Invalid availability target.");return parsed.data;}
export function inventoryPrecondition(blockedReason:string):never {throw new AppError("PRECONDITION_FAILED",blockedReason,{blockedReason});}

async function binding(db:DbExecutor,actor:DomainActor,storefrontId:string) {
  const [store]=await db.select().from(storefronts).where(eq(storefronts.id,storefrontId));
  if(!store?.active) throw new AppError("NOT_FOUND","Active storefront not found.");
  if(!store.availabilityPoolId) inventoryPrecondition("AVAILABILITY_POOL_REQUIRED");
  const [pool]=await db.select().from(stockPools).where(eq(stockPools.id,store.availabilityPoolId));
  if(!pool?.active) inventoryPrecondition("AVAILABILITY_POOL_INACTIVE");
  const access=await inventoryAccess(db,actor,pool.ownerEntityId);
  if(pool.ownerEntityId!==store.sellerEntityId) {
    if(access.user.role!=="ADMIN") throw new AppError("FORBIDDEN","Cross-entity availability requires admin.");
    if((await getActiveEntityRelationship(db,pool.ownerEntityId,store.sellerEntityId))?.mode!=="CONSIGNMENT") inventoryPrecondition("AVAILABILITY_CONSIGNMENT_REQUIRED");
  }
  return {store,pool};
}
export async function previewOnlineAvailability(db:DbExecutor,actor:DomainActor,raw:AvailabilityTarget) {
  const input=parse(targetSchema,raw), {store,pool}=await binding(db,actor,input.storefrontId);
  const rows=await db.select({allocation:allocations,balance:allocationBalances}).from(allocations).leftJoin(allocationBalances,eq(allocationBalances.allocationId,allocations.id))
    .where(and(eq(allocations.skuId,input.skuId),eq(allocations.storefrontId,store.id)));
  if(rows.some((r)=>r.allocation.poolId!==pool.id && (r.balance?.availableToSell??0)>0)) inventoryPrecondition("AVAILABILITY_MULTIPLE_POOLS");
  const current=rows.find((r)=>r.allocation.poolId===pool.id)?.balance;
  return {...input,poolId:pool.id,previousAvailable:current?.availableToSell??0,reserved:current?.reserved??0,committed:current?.committed??0,delta:input.target-(current?.availableToSell??0)};
}

/** ADR-013: idempotency, read, absolute-target calculation and movements share the same transaction. */
export async function setOnlineAvailability(db:DbExecutor,actor:DomainActor,raw:SetAvailabilityInput) {
  const {idempotencyKey,...input}=parse(setSchema,raw);
  await inventoryAccess(db,actor);
  return executeIdempotent(db,{scope:"m8:availability:"+actor.userId,idempotencyKey,payload:input},async(tx)=>{
    const body=await withDomainTransaction(tx,actor,async(ctx)=>{
      await acquireDomainLocks(ctx.tx,{sharedAdvisoryKeys:[INVENTORY_CONFIGURATION_LOCK]});
      const initial=await binding(ctx.tx,actor,input.storefrontId);
      await acquireDomainLocks(ctx.tx,{advisoryKeys:[storefrontInventoryKey(initial.store.id),relationshipInventoryKey(initial.pool.ownerEntityId,initial.store.sellerEntityId)],skuIds:[input.skuId]});
      const {store,pool}=await binding(ctx.tx,actor,input.storefrontId);
      const [sku]=await ctx.tx.select().from(skus).where(eq(skus.id,input.skuId));
      if(!sku || sku.lifecycleState==="ARCHIVED") inventoryPrecondition("AVAILABILITY_SKU_ARCHIVED");
      let all=await ctx.tx.select().from(allocations).where(eq(allocations.skuId,input.skuId));
      let allocation=all.find((a)=>a.poolId===pool.id && a.storefrontId===store.id);
      if(!allocation) {
        [allocation]=await ctx.tx.insert(allocations).values({id:createUuidV7(),poolId:pool.id,storefrontId:store.id,skuId:input.skuId}).returning();
        all=[...all,allocation!];
        await ctx.recordAudit({action:"ALLOCATION_CREATED",entityType:"allocation",entityId:allocation!.id,after:allocation});
      }
      // Protect the ambiguity check and the engine's complete pool/allocation plan before reading the current amount.
      const poolIds=[...new Set([pool.id,...all.filter((a)=>a.storefrontId===store.id).map((a)=>a.poolId)])];
      const lockedAllocations=all.filter((a)=>poolIds.includes(a.poolId));
      await acquireDomainLocks(ctx.tx,{poolBalances:poolIds.map((poolId)=>({poolId,skuId:input.skuId})),allocationIds:lockedAllocations.map((a)=>a.id)});
      const balances=await ctx.tx.select().from(allocationBalances).where(sql`${allocationBalances.allocationId} IN (${sql.join(lockedAllocations.map((a)=>sql`${a.id}::uuid`),sql`,`)})`);
      if(all.some((a)=>a.storefrontId===store.id && a.poolId!==pool.id && (balances.find((b)=>b.allocationId===a.id)?.availableToSell??0)>0)) inventoryPrecondition("AVAILABILITY_MULTIPLE_POOLS");
      const current=balances.find((b)=>b.allocationId===allocation!.id)!;
      if(input.target+current.reserved+current.committed>2_147_483_647) inventoryPrecondition("AVAILABILITY_TOO_LARGE");
      const delta=input.target-current.availableToSell;
      const base={poolId:pool.id,skuId:input.skuId,quantity:Math.abs(delta),reason:"availability set"};
      const movements:StockMovement[]=delta>0 ? [{...base,type:"STOCK_IN"},{...base,type:"ALLOCATE",allocationId:allocation!.id}]
        : delta<0 ? [{...base,type:"DEALLOCATE",allocationId:allocation!.id},{...base,type:"STOCK_OUT"}] : [];
      const result=movements.length ? await applyStockMovements(ctx.tx,actor,movements) : {status:"APPLIED",rows:[]};
      if(result.status!=="APPLIED") throw new AppError("INVARIANT_VIOLATION","Availability movements were not applied.");
      if(!movements.length) await refreshAllocationStockStatus(ctx,allocation!.id);
      if(input.replenishmentRequestId) {
        const [request]=await ctx.tx.select().from(replenishmentRequests).where(eq(replenishmentRequests.id,input.replenishmentRequestId)).for("update");
        if(!request || request.allocationId!==allocation!.id || !["OPEN","ACKNOWLEDGED"].includes(request.status)) inventoryPrecondition("REPLENISHMENT_NOT_OPEN");
        await ctx.tx.update(replenishmentRequests).set({status:"FULFILLED",updatedBy:actor.userId,updatedAt:new Date()}).where(eq(replenishmentRequests.id,request.id));
        await ctx.recordAudit({action:"REPLENISHMENT_FULFILLED",entityType:"replenishment_request",entityId:request.id,before:request,after:{status:"FULFILLED"},reason:"availability set"});
        await ctx.emitOutboxEvent({eventType:"REPLENISHMENT_CHANGED",aggregateType:"allocation",aggregateId:allocation!.id,payload:{requestId:request.id,status:"FULFILLED"},consumers:["notifications"]});
      }
      const outcome={skuId:input.skuId,storefrontId:store.id,poolId:pool.id,allocationId:allocation!.id,previousAvailable:current.availableToSell,availableToSell:input.target,
        delta,reserved:current.reserved,committed:current.committed,ledgerIds:result.rows.map((r)=>r.id),replenishmentRequestId:input.replenishmentRequestId??null};
      await ctx.recordAudit({action:"ONLINE_AVAILABILITY_SET",entityType:"allocation",entityId:allocation!.id,before:{availableToSell:current.availableToSell,reserved:current.reserved,committed:current.committed},after:outcome,reason:"availability set"});
      await ctx.emitOutboxEvent({eventType:"ONLINE_AVAILABILITY_SET",storefrontId:store.id,aggregateType:"sku",aggregateId:input.skuId,payload:outcome,consumers:["storefront:"+store.id]});
      return outcome;
    });
    return {status:200,body};
  });
}

/** Internal commerce facts, never a client-supplied owner override. */
export async function getSkuAllocationFacts(db:DbExecutor,skuId:string) {
  return db.select({storefrontId:allocations.storefrontId,poolId:allocations.poolId,ownerEntityId:stockPools.ownerEntityId,
    availableToSell:sql<number>`coalesce(${allocationBalances.availableToSell},0)::integer`}).from(allocations)
    .innerJoin(stockPools,eq(stockPools.id,allocations.poolId)).leftJoin(allocationBalances,eq(allocationBalances.allocationId,allocations.id)).where(eq(allocations.skuId,skuId));
}
export async function listInventoryWorkspace(db:DbExecutor,actor:DomainActor,storefrontId:string) {
  const {user,ownerIds}=await inventoryAccess(db,actor);
  const [store]=await db.select().from(storefronts).where(eq(storefronts.id,storefrontId));
  if(!store) throw new AppError("NOT_FOUND","Storefront not found.");
  const pools=await db.select().from(stockPools).where(eq(stockPools.active,true));
  const pool=pools.find((p)=>p.id===store.availabilityPoolId);
  if(user.role!=="ADMIN" && (!pool || !ownerIds.includes(pool.ownerEntityId) || pool.ownerEntityId!==store.sellerEntityId)) throw new AppError("FORBIDDEN","Inventory belongs to another entity.");
  const products=await db.select({skuId:skus.id,code:skus.internalSku,name:skus.displayNameKa}).from(skus).where(ne(skus.lifecycleState,"ARCHIVED")).orderBy(asc(skus.internalSku));
  const rows=pool ? await db.select({allocation:allocations,balance:allocationBalances}).from(allocations).leftJoin(allocationBalances,eq(allocationBalances.allocationId,allocations.id)).where(and(eq(allocations.poolId,pool.id),eq(allocations.storefrontId,store.id))) : [];
  return {store,pool:pool??null,rows:products.map((p)=>{const row=rows.find((r)=>r.allocation.skuId===p.skuId);return {...p,name:p.name??p.code,allocationId:row?.allocation.id??null,availableToSell:row?.balance?.availableToSell??0,reserved:row?.balance?.reserved??0,committed:row?.balance?.committed??0,minimumStock:row?.allocation.minimumStock??0,status:row?.allocation.alertState??"NORMAL"};})};
}

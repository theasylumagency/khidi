import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getPostgresError,allocations, allocationBalances, legalEntities, poolLocations, poolSkuBalances, skus, stockPools, storefronts, type DbExecutor } from "@khidi/db";
import { withDomainTransaction, type DomainActor } from "@khidi/domain";
import { acquireDomainLocks, INVENTORY_CONFIGURATION_LOCK } from "@khidi/domain/locking";
import { AppError, createUuidV7 } from "@khidi/shared";
import { getActiveEntityRelationship } from "@khidi/entities";
import { inventoryAccess, relationshipInventoryKey, storefrontInventoryKey } from "./access.ts";
import { applyStockMovements } from "./engine.ts";
import { inventoryPrecondition } from "./availability.ts";
import type { StockMovement } from "./types.ts";

export async function createStockPool(db:DbExecutor,actor:DomainActor,raw:{ownerEntityId:string;name:string}) {
  const parsed=z.object({ownerEntityId:z.string().max(36).uuid(),name:z.string().trim().min(1).max(120)}).strict().safeParse(raw);
  if(!parsed.success) throw new AppError("VALIDATION_ERROR","Invalid pool.");
  return withDomainTransaction(db,actor,async(ctx)=>{
    await inventoryAccess(ctx.tx,actor,undefined,true);
    const [owner]=await ctx.tx.select().from(legalEntities).where(and(eq(legalEntities.id,parsed.data.ownerEntityId),eq(legalEntities.active,true)));
    if(!owner) throw new AppError("NOT_FOUND","Active owner not found.");
    const [pool]=await ctx.tx.insert(stockPools).values({id:createUuidV7(),...parsed.data}).returning();
    await ctx.tx.insert(poolLocations).values((["SHELF","STAGING"] as const).map((kind)=>({id:createUuidV7(),poolId:pool!.id,kind,name:kind})));
    await ctx.recordAudit({action:"STOCK_POOL_CREATED",entityType:"stock_pool",entityId:pool!.id,after:pool});
    await ctx.emitOutboxEvent({eventType:"INVENTORY_CONFIGURED",aggregateType:"stock_pool",aggregateId:pool!.id,payload:{poolId:pool!.id},consumers:[]});
    return pool!;
  });
}
export async function configureAvailabilityPool(db:DbExecutor,actor:DomainActor,raw:{storefrontId:string;poolId:string}) {
  const parsed=z.object({storefrontId:z.string().max(36).uuid(),poolId:z.string().max(36).uuid()}).strict().safeParse(raw);
  if(!parsed.success) throw new AppError("VALIDATION_ERROR","Invalid pool configuration.");
  return withDomainTransaction(db,actor,async(ctx)=>{
    await inventoryAccess(ctx.tx,actor,undefined,true);
    await acquireDomainLocks(ctx.tx,{advisoryKeys:[INVENTORY_CONFIGURATION_LOCK]});
    const [store]=await ctx.tx.select().from(storefronts).where(eq(storefronts.id,parsed.data.storefrontId));
    const [pool]=await ctx.tx.select().from(stockPools).where(and(eq(stockPools.id,parsed.data.poolId),eq(stockPools.active,true)));
    if(!store || !pool) throw new AppError("NOT_FOUND","Storefront or active pool not found.");
    const oldPool=store.availabilityPoolId ? (await ctx.tx.select().from(stockPools).where(eq(stockPools.id,store.availabilityPoolId)))[0] : undefined;
    const keys=[storefrontInventoryKey(store.id),relationshipInventoryKey(pool.ownerEntityId,store.sellerEntityId),...(oldPool?[relationshipInventoryKey(oldPool.ownerEntityId,store.sellerEntityId)]:[])];
    const affected=await ctx.tx.select().from(allocations).where(and(eq(allocations.storefrontId,store.id),inArray(allocations.poolId,[pool.id,...(oldPool?[oldPool.id]:[])])));
    await acquireDomainLocks(ctx.tx,{advisoryKeys:keys,skuIds:affected.map((a)=>a.skuId),poolBalances:affected.map((a)=>({poolId:a.poolId,skuId:a.skuId})),allocationIds:affected.map((a)=>a.id)});
    const [current]=await ctx.tx.select().from(storefronts).where(eq(storefronts.id,store.id));
    if(current!.availabilityPoolId===pool.id) return current!;
    if(pool.ownerEntityId!==store.sellerEntityId && (await getActiveEntityRelationship(ctx.tx,pool.ownerEntityId,store.sellerEntityId))?.mode!=="CONSIGNMENT") inventoryPrecondition("AVAILABILITY_CONSIGNMENT_REQUIRED");
    let updated:typeof storefronts.$inferSelect|undefined;
    try { [updated]=await ctx.tx.update(storefronts).set({availabilityPoolId:pool.id}).where(eq(storefronts.id,store.id)).returning(); }
    catch(error) {
      if(getPostgresError(error)?.message.includes("AVAILABILITY_POOL_NOT_DRAINED")) inventoryPrecondition("AVAILABILITY_POOL_NOT_DRAINED");
      throw error;
    }
    await ctx.recordAudit({action:"AVAILABILITY_POOL_CONFIGURED",entityType:"storefront",entityId:store.id,before:{availabilityPoolId:current!.availabilityPoolId},after:{availabilityPoolId:pool.id}});
    await ctx.emitOutboxEvent({eventType:"INVENTORY_CONFIGURED",aggregateType:"storefront",aggregateId:store.id,payload:{availabilityPoolId:pool.id},consumers:[]});
    return updated!;
  });
}

export const advancedStockSchema=z.object({
  operation:z.enum(["STOCK_IN","STOCK_OUT","WRITE_OFF","ALLOCATE","DEALLOCATE","TRANSFER_SAME_POOL","TRANSFER_PURCHASE"]),
  skuId:z.string().max(36).uuid(),poolId:z.string().max(36).uuid(),quantity:z.number().int().positive().max(2_147_483_647),
  storefrontId:z.string().max(36).uuid().optional(),targetStorefrontId:z.string().max(36).uuid().optional(),targetPoolId:z.string().max(36).uuid().optional(),
  reason:z.string().trim().min(1).max(1000),documentRef:z.string().trim().min(1).max(1000).optional()
}).strict();
export type AdvancedStockInput=z.infer<typeof advancedStockSchema>;
export async function getAdvancedInventoryBalances(db:DbExecutor,actor:DomainActor) {
  await inventoryAccess(db,actor,undefined,true);
  const pools=await db.select({poolId:stockPools.id,poolName:stockPools.name,skuId:skus.id,code:skus.internalSku,shelf:poolSkuBalances.shelf,staging:poolSkuBalances.staging,unallocated:poolSkuBalances.unallocated})
    .from(poolSkuBalances).innerJoin(stockPools,eq(stockPools.id,poolSkuBalances.poolId)).innerJoin(skus,eq(skus.id,poolSkuBalances.skuId));
  const assigned=await db.select({poolId:allocations.poolId,skuId:allocations.skuId,storefrontId:storefronts.id,storeName:storefronts.name,availableToSell:allocationBalances.availableToSell,reserved:allocationBalances.reserved,committed:allocationBalances.committed})
    .from(allocations).innerJoin(storefronts,eq(storefronts.id,allocations.storefrontId)).innerJoin(allocationBalances,eq(allocationBalances.allocationId,allocations.id));
  return {pools,assigned};
}
export async function applyAdvancedStockOperation(db:DbExecutor,actor:DomainActor,raw:AdvancedStockInput) {
  const parsed=advancedStockSchema.safeParse(raw);
  if(!parsed.success) throw new AppError("VALIDATION_ERROR","Invalid advanced stock operation.");
  const input=parsed.data;
  return withDomainTransaction(db,actor,async(ctx)=>{
    await inventoryAccess(ctx.tx,actor,undefined,true);
    await acquireDomainLocks(ctx.tx,{sharedAdvisoryKeys:[INVENTORY_CONFIGURATION_LOCK]});
    const poolIds=[...new Set([input.poolId,...(input.targetPoolId?[input.targetPoolId]:[])])];
    const pools=await ctx.tx.select().from(stockPools).where(inArray(stockPools.id,poolIds));
    const stores=await ctx.tx.select().from(storefronts);
    const pool=pools.find((p)=>p.id===input.poolId);
    if(!pool) throw new AppError("NOT_FOUND","Pool not found.");
    const advisoryKeys=pools.flatMap((p)=>[input.storefrontId,input.targetStorefrontId].flatMap((id)=>{
      const store=stores.find((s)=>s.id===id);return store?[relationshipInventoryKey(p.ownerEntityId,store.sellerEntityId)]:[];
    }));
    const targetPool=pools.find((p)=>p.id===input.targetPoolId);
    if(targetPool) advisoryKeys.push(relationshipInventoryKey(pool.ownerEntityId,targetPool.ownerEntityId));
    await acquireDomainLocks(ctx.tx,{advisoryKeys,skuIds:[input.skuId]});
    async function allocation(storefrontId:string|undefined,create:boolean) {
      if(!storefrontId) throw new AppError("VALIDATION_ERROR","Storefront is required.");
      const [existing]=await ctx.tx.select().from(allocations).where(and(eq(allocations.poolId,input.poolId),eq(allocations.storefrontId,storefrontId),eq(allocations.skuId,input.skuId)));
      if(existing) return existing.id;
      if(!create) throw new AppError("NOT_FOUND","Allocation not found.");
      const [row]=await ctx.tx.insert(allocations).values({id:createUuidV7(),poolId:input.poolId,storefrontId,skuId:input.skuId}).returning();
      await ctx.recordAudit({action:"ALLOCATION_CREATED",entityType:"allocation",entityId:row!.id,after:row});
      return row!.id;
    }
    const base={poolId:input.poolId,skuId:input.skuId,quantity:input.quantity,reason:input.reason,documentRef:input.documentRef};
    let movements:StockMovement[];
    if(input.operation==="ALLOCATE" || input.operation==="DEALLOCATE") movements=[{...base,type:input.operation,allocationId:await allocation(input.storefrontId,input.operation==="ALLOCATE")}];
    else if(input.operation==="TRANSFER_SAME_POOL") {
      movements=[{...base,type:"TRANSFER_OUT",variant:"SAME_POOL",transferKey:"advanced",allocationId:await allocation(input.storefrontId,false)},
        {...base,type:"TRANSFER_IN",variant:"SAME_POOL",transferKey:"advanced",allocationId:await allocation(input.targetStorefrontId,true)}];
    } else if(input.operation==="TRANSFER_PURCHASE") {
      if(!targetPool) throw new AppError("VALIDATION_ERROR","Receiving pool is required.");
      movements=[{...base,type:"TRANSFER_OUT",variant:"CROSS_POOL",transferKey:"advanced"},{...base,poolId:targetPool.id,type:"TRANSFER_IN",variant:"CROSS_POOL",transferKey:"advanced"}];
    } else movements=[{...base,type:input.operation}];
    return applyStockMovements(ctx.tx,actor,movements);
  });
}

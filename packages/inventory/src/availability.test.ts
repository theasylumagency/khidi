import { expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { allocationBalances, allocations, stockLedger, storefronts, entityRelationships, userEntityMemberships, users } from "@khidi/db";
import { acquireDomainLocks } from "@khidi/domain/locking";
import { createUuidV7 } from "@khidi/shared";
import { configureAvailabilityPool, createStockPool, applyAdvancedStockOperation } from "./advanced.ts";
import { setEntityRelationship } from "@khidi/entities";
import { setOnlineAvailability } from "./availability.ts";
import { applyStockMovements } from "./engine.ts";
import { inventoryFixture } from "./test-fixture.ts";
import { primitiveWorkflowFixture } from "./primitive-workflow.test-fixture.ts";

async function fixture(seed=true) {
  const f=await inventoryFixture(seed);
  await configureAvailabilityPool(f.db,f.actor,{storefrontId:f.stores[0]!.id,poolId:f.base.poolId});
  const set=(target:number,key=createUuidV7())=>setOnlineAvailability(f.db,f.actor,{skuId:f.sku.id,storefrontId:f.stores[0]!.id,target,idempotencyKey:key});
  const balance=async()=> (await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.line.allocationId)))[0]!;
  return {...f,set,balance};
}
it("higher/lower absolute targets derive only the difference, retain held units and never update the other storefront's allocation",async()=>{
  const f=await fixture();
  await f.apply([{...f.base,allocationId:f.as[1]!.id,type:"ALLOCATE",quantity:10},{...f.line,type:"RESERVE",quantity:5,paymentMethod:"CARD"},{...f.line,type:"COMMIT",quantity:2}]);
  const other=await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[1]!.id));
  const increased=await f.set(70);
  expect(increased.body).toMatchObject({previousAvailable:55,availableToSell:70,delta:15,reserved:3,committed:2});
  expect(await f.balance()).toMatchObject({allocated:75,availableToSell:70,reserved:3,committed:2});
  expect(await f.db.select().from(stockLedger).where(sql`${stockLedger.id} IN (${sql.join(increased.body.ledgerIds.map((id)=>sql`${id}::uuid`),sql`,`)})`))
    .toMatchObject([{movementType:"STOCK_IN",quantity:15,reason:"availability set"},{movementType:"ALLOCATE",quantity:15,reason:"availability set"}]);
  const lowered=await f.set(0);
  expect(lowered.body).toMatchObject({delta:-70,availableToSell:0,reserved:3,committed:2});
  expect(await f.balance()).toMatchObject({allocated:5,reserved:3,committed:2,availableToSell:0});
  const rows=await f.db.select().from(stockLedger).where(sql`${stockLedger.id} IN (${sql.join(lowered.body.ledgerIds.map((id)=>sql`${id}::uuid`),sql`,`)})`);
  expect(rows).toMatchObject([{movementType:"DEALLOCATE",quantity:70},{movementType:"STOCK_OUT",quantity:70}]);
  expect(await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[1]!.id))).toEqual(other);
});
it("serializes two absolute admin targets and does not apply a replay after an intervening reservation",async()=>{
  const f=await fixture(false);
  const results=await Promise.all([f.set(8),f.set(13)]);
  expect(results.map((r)=>r.body.previousAvailable)).toContain(0);
  const last=results.find((r)=>r.body.previousAvailable!==0)!;
  expect(await f.balance()).toMatchObject({availableToSell:last.body.availableToSell});
  const key=createUuidV7(),first=await f.set(10,key);
  await f.apply([{...f.line,type:"RESERVE",quantity:2,paymentMethod:"CARD"}]);
  const count=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
  const replay=await f.set(10,key);
  expect(replay.replayed).toBe(true);expect(replay.body).toEqual(first.body);
  expect(await f.balance()).toMatchObject({availableToSell:8,reserved:2});
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id))).toHaveLength(count.length);
  await expect(f.set(11,key)).rejects.toMatchObject({code:"IDEMPOTENCY_CONFLICT"});
});
it("computes its difference after a concurrent reservation releases its allocation lock",async()=>{
  const f=await fixture(false);await f.set(10);
  const prepared=await f.db.transaction((tx)=>primitiveWorkflowFixture(tx,f.actor.userId,[{...f.line,type:"RESERVE",quantity:2,paymentMethod:"CARD"}]));
  let pending:ReturnType<typeof f.set>|undefined;
  const tag="availability-"+createUuidV7();
  await f.db.transaction(async(tx)=>{
    await acquireDomainLocks(tx,{allocationIds:[f.line.allocationId]});
    pending=f.db.transaction(async(other)=>{
      await other.execute(sql`SELECT set_config('application_name',${tag},true)`);
      return setOnlineAvailability(other,f.actor,{skuId:f.sku.id,storefrontId:f.stores[0]!.id,target:10,idempotencyKey:createUuidV7()});
    });void pending.catch(()=>{});
    let waiting=false;
    for(let i=0;i<200;i++) {
      const state=await f.db.execute<{wait_event_type:string|null}>(sql`SELECT wait_event_type FROM pg_stat_activity WHERE application_name=${tag}`);
      if(state.rows.some((r)=>r.wait_event_type==="Lock")){waiting=true;break;}
      await new Promise((resolve)=>setTimeout(resolve,10));
    }
    expect(waiting).toBe(true);
    await applyStockMovements(tx,f.actor,prepared);
  });
  expect((await pending)!.body).toMatchObject({previousAvailable:8,delta:2,availableToSell:10,reserved:2});
  expect(await f.balance()).toMatchObject({allocated:12,availableToSell:10,reserved:2});
});
it("refuses free units in a second pool and preserves every ledger row",async()=>{
  const f=await fixture(false);await f.set(10);
  const other=await createStockPool(f.db,f.actor,{ownerEntityId:f.entities[0]!.id,name:"Other pool"});
  await applyAdvancedStockOperation(f.db,f.actor,{operation:"STOCK_IN",poolId:other.id,skuId:f.sku.id,quantity:2,reason:"Fixture"});
  await applyAdvancedStockOperation(f.db,f.actor,{operation:"ALLOCATE",poolId:other.id,skuId:f.sku.id,storefrontId:f.stores[0]!.id,quantity:2,reason:"Fixture"});
  const before=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
  await expect(f.set(9)).rejects.toMatchObject({details:{blockedReason:"AVAILABILITY_MULTIPLE_POOLS"}});
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id))).toEqual(before);
});
it("creates the configured allocation on first use, enforces drained/CONSIGNMENT configuration and role scope",async()=>{
  const f=await fixture(false),second=f.stores[2]!;
  await expect(setOnlineAvailability(f.db,f.actor,{skuId:f.sku.id,storefrontId:second.id,target:2,idempotencyKey:createUuidV7()})).rejects.toMatchObject({details:{blockedReason:"AVAILABILITY_POOL_REQUIRED"}});
  await expect(configureAvailabilityPool(f.db,f.actor,{storefrontId:second.id,poolId:f.base.poolId})).rejects.toMatchObject({details:{blockedReason:"AVAILABILITY_CONSIGNMENT_REQUIRED"}});
  await f.db.insert(entityRelationships).values({id:createUuidV7(),fromEntityId:f.entities[0]!.id,toEntityId:f.entities[1]!.id,mode:"CONSIGNMENT",effectiveFrom:new Date(0)});
  await configureAvailabilityPool(f.db,f.actor,{storefrontId:second.id,poolId:f.base.poolId});
  await setOnlineAvailability(f.db,f.actor,{skuId:f.sku.id,storefrontId:second.id,target:2,idempotencyKey:createUuidV7()});
  expect(await f.db.select().from(allocations).where(and(eq(allocations.skuId,f.sku.id),eq(allocations.storefrontId,second.id)))).toHaveLength(1);
  await expect(configureAvailabilityPool(f.db,f.actor,{storefrontId:second.id,poolId:f.pools[1]!.id})).rejects.toMatchObject({details:{blockedReason:"AVAILABILITY_POOL_NOT_DRAINED"}});
  await expect(f.db.update(storefronts).set({availabilityPoolId:f.pools[1]!.id}).where(eq(storefronts.id,second.id))).rejects.toMatchObject({cause:{message:expect.stringMatching(/AVAILABILITY_POOL_NOT_DRAINED/)}});
  for(const role of ["STOCK_MANAGER","WAREHOUSE"]){
    const [user]=await f.db.insert(users).values({id:createUuidV7(),role,fullName:"Inventory scope"}).returning();
    await f.db.insert(userEntityMemberships).values({userId:user!.id,legalEntityId:f.entities[0]!.id});
    const own=()=>setOnlineAvailability(f.db,{userId:user!.id},{skuId:f.sku.id,storefrontId:f.stores[0]!.id,target:1,idempotencyKey:createUuidV7()});
    if(role==="STOCK_MANAGER") await own();else await expect(own()).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(applyAdvancedStockOperation(f.db,{userId:user!.id},{operation:"STOCK_IN",...f.base,quantity:1,reason:"Fixture"})).rejects.toMatchObject({code:"FORBIDDEN"});
  }
});

it("changes a drained storefront's pool to zero without touching shared-pool stock and blocks mode changes until the binding moves",async()=>{
  const f=await fixture(false),foreign=f.stores[2]!;
  const pair={fromEntityId:f.entities[0]!.id,toEntityId:f.entities[1]!.id};
  await setEntityRelationship(f.db,f.actor,{...pair,mode:"CONSIGNMENT"});
  await configureAvailabilityPool(f.db,f.actor,{storefrontId:foreign.id,poolId:f.base.poolId});
  const foreignSet=(target:number)=>setOnlineAvailability(f.db,f.actor,{skuId:f.sku.id,storefrontId:foreign.id,target,idempotencyKey:createUuidV7()});
  const first=await foreignSet(3);await f.set(7);
  await expect(configureAvailabilityPool(f.db,f.actor,{storefrontId:foreign.id,poolId:f.pools[1]!.id})).rejects.toMatchObject({details:{blockedReason:"AVAILABILITY_POOL_NOT_DRAINED"}});
  await f.apply([{...f.line,allocationId:first.body.allocationId,type:"RESERVE",quantity:1,paymentMethod:"CARD"}]);
  await foreignSet(0);
  await expect(configureAvailabilityPool(f.db,f.actor,{storefrontId:foreign.id,poolId:f.pools[1]!.id})).rejects.toMatchObject({details:{blockedReason:"AVAILABILITY_POOL_NOT_DRAINED"}});
  await f.apply([{...f.line,allocationId:first.body.allocationId,type:"COMMIT",quantity:1},{...f.line,allocationId:first.body.allocationId,type:"PICK_TO_STAGING",quantity:1}]);
  await expect(configureAvailabilityPool(f.db,f.actor,{storefrontId:foreign.id,poolId:f.pools[1]!.id})).rejects.toMatchObject({details:{blockedReason:"AVAILABILITY_POOL_NOT_DRAINED"}});
  await f.apply([{...f.line,allocationId:first.body.allocationId,type:"RETURN_TO_SHELF",quantity:1,scanConfirmed:true},{...f.line,allocationId:first.body.allocationId,type:"COMMIT_RELEASE",quantity:1}]);await foreignSet(0);
  await expect(setEntityRelationship(f.db,f.actor,{...pair,mode:"PURCHASE"})).rejects.toMatchObject({details:{blockedReason:"RELATIONSHIP_POOL_BINDING"}});
  await expect(f.db.insert(entityRelationships).values({id:createUuidV7(),...pair,mode:"PURCHASE",effectiveFrom:new Date()})).rejects.toMatchObject({cause:{message:expect.stringMatching(/RELATIONSHIP_POOL_BINDING/)}});
  const otherBefore=await f.balance(),ledgerBefore=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
  await configureAvailabilityPool(f.db,f.actor,{storefrontId:foreign.id,poolId:f.pools[1]!.id});
  expect(await f.balance()).toEqual(otherBefore);
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id))).toEqual(ledgerBefore);
  await setEntityRelationship(f.db,f.actor,{...pair,mode:"PURCHASE"});
  const next=await foreignSet(2);expect(next.body).toMatchObject({poolId:f.pools[1]!.id,previousAvailable:0,availableToSell:2});
});

it("refuses existing destination stock and serializes a pool change against an availability declaration",async()=>{
  const f=await fixture(false);await f.set(0);
  const other=await createStockPool(f.db,f.actor,{ownerEntityId:f.entities[0]!.id,name:"Destination"});
  await applyAdvancedStockOperation(f.db,f.actor,{operation:"STOCK_IN",poolId:other.id,skuId:f.sku.id,quantity:2,reason:"Advanced stock"});
  await applyAdvancedStockOperation(f.db,f.actor,{operation:"ALLOCATE",poolId:other.id,skuId:f.sku.id,storefrontId:f.stores[0]!.id,quantity:2,reason:"Advanced allocation"});
  await expect(configureAvailabilityPool(f.db,f.actor,{storefrontId:f.stores[0]!.id,poolId:other.id})).rejects.toMatchObject({details:{blockedReason:"AVAILABILITY_POOL_NOT_DRAINED"}});
  await applyAdvancedStockOperation(f.db,f.actor,{operation:"DEALLOCATE",poolId:other.id,skuId:f.sku.id,storefrontId:f.stores[0]!.id,quantity:2,reason:"Drain"});
  await applyAdvancedStockOperation(f.db,f.actor,{operation:"STOCK_OUT",poolId:other.id,skuId:f.sku.id,quantity:2,reason:"Drain"});
  const results=await Promise.allSettled([f.set(5),configureAvailabilityPool(f.db,f.actor,{storefrontId:f.stores[0]!.id,poolId:other.id})]);
  expect(results[0]!.status).toBe("fulfilled");
  const current=(await f.db.select().from(storefronts).where(eq(storefronts.id,f.stores[0]!.id)))[0]!;
  const ownAllocations=await f.db.select({allocation:allocations,balance:allocationBalances}).from(allocations).innerJoin(allocationBalances,eq(allocationBalances.allocationId,allocations.id)).where(eq(allocations.storefrontId,current.id));
  expect(ownAllocations.find((r)=>r.allocation.poolId===current.availabilityPoolId)!.balance.availableToSell).toBe(5);
  expect(ownAllocations.filter((r)=>r.allocation.poolId!==current.availabilityPoolId).every((r)=>r.balance.availableToSell===0)).toBe(true);
});

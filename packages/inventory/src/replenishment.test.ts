import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { allocationBalances, allocations, inventoryNotifications,outboxEvents, replenishmentRequests, stockLedger, users, userEntityMemberships } from "@khidi/db";
import { setEntityRelationship } from "@khidi/entities";
import { createUuidV7 } from "@khidi/shared";
import { configureAvailabilityPool, applyAdvancedStockOperation } from "./advanced.ts";
import { setOnlineAvailability } from "./availability.ts";
import { allocationStockStatus, listInventoryActions, requestReplenishment, respondToReplenishment, setAllocationMinimum } from "./replenishment.ts";
import { inventoryFixture } from "./test-fixture.ts";

it("uses the approved boundaries, including zero minimum, and emits once per transition to owner staff",async()=>{
  expect([allocationStockStatus(0,0),allocationStockStatus(1,0),allocationStockStatus(1,3),allocationStockStatus(3,3),allocationStockStatus(4,3)])
    .toEqual(["OUT_OF_STOCK","NORMAL","LOW_STOCK","LOW_STOCK","NORMAL"]);
  const f=await inventoryFixture(false);
  const [manager]=await f.db.insert(users).values({id:createUuidV7(),role:"STOCK_MANAGER",fullName:"Owner manager"}).returning();
  await f.db.insert(userEntityMemberships).values({userId:manager!.id,legalEntityId:f.entities[0]!.id});
  await configureAvailabilityPool(f.db,f.actor,{storefrontId:f.stores[0]!.id,poolId:f.base.poolId});
  const set=(target:number)=>setOnlineAvailability(f.db,f.actor,{skuId:f.sku.id,storefrontId:f.stores[0]!.id,target,idempotencyKey:createUuidV7()});
  await set(5);await setAllocationMinimum(f.db,f.actor,{allocationId:f.line.allocationId,minimum:3});
  await set(3);await set(2);await set(0);await set(0);await set(5);
  const notices=await f.db.query.outboxEvents.findMany({where:(e,{and,eq,inArray})=>and(eq(e.aggregateId,f.line.allocationId),inArray(e.eventType,["STOCK_LOW","STOCK_OUT","STOCK_RECOVERED"])),orderBy:(e,{asc})=>[asc(e.createdAt),asc(e.id)]});
  expect(notices.map((n)=>n.payloadJson.status)).toEqual(["LOW_STOCK","OUT_OF_STOCK","NORMAL"]);
  for(const n of notices)expect(n.payloadJson.recipientUserIds).toEqual([manager!.id]);
  // M10 creates unified notifications through the outbox consumer; the legacy table is history only.
  expect(await f.db.select().from(inventoryNotifications).where(eq(inventoryNotifications.allocationId,f.line.allocationId))).toHaveLength(0);
  expect((await listInventoryActions(f.db,{userId:manager!.id})).notifications).toHaveLength(0);
});
it("replenishment creation/acknowledgement/decline changes no stock; only referenced availability fulfills it",async()=>{
  const f=await inventoryFixture();
  await configureAvailabilityPool(f.db,f.actor,{storefrontId:f.stores[0]!.id,poolId:f.base.poolId});
  const before=await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.line.allocationId));
  const ledger=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
  const request=await requestReplenishment(f.db,f.actor,{allocationId:f.line.allocationId,quantity:8});
  await respondToReplenishment(f.db,f.actor,{requestId:request.id,status:"ACKNOWLEDGED"});
  expect(await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.line.allocationId))).toEqual(before);
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id))).toEqual(ledger);
  await setOnlineAvailability(f.db,f.actor,{skuId:f.sku.id,storefrontId:f.stores[0]!.id,target:68,replenishmentRequestId:request.id,idempotencyKey:createUuidV7()});
  expect((await f.db.select().from(replenishmentRequests).where(eq(replenishmentRequests.id,request.id)))[0]!.status).toBe("FULFILLED");
  const declined=await requestReplenishment(f.db,f.actor,{allocationId:f.line.allocationId,quantity:1});
  const beforeDecline=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
  await respondToReplenishment(f.db,f.actor,{requestId:declined.id,status:"DECLINED",note:"Not needed"});
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id))).toEqual(beforeDecline);
  await expect(respondToReplenishment(f.db,f.actor,{requestId:declined.id,status:"ACKNOWLEDGED"})).rejects.toThrow();
});
it("C17 uses real held balances and permits PURCHASE only after draining; Rule B stays admin-only",async()=>{
  const f=await inventoryFixture(false),foreign=f.stores[2]!;
  const pair={fromEntityId:f.entities[0]!.id,toEntityId:f.entities[1]!.id};
  await setEntityRelationship(f.db,f.actor,{...pair,mode:"CONSIGNMENT"});
  await applyAdvancedStockOperation(f.db,f.actor,{operation:"STOCK_IN",...f.base,quantity:6,reason:"Fixture"});
  await applyAdvancedStockOperation(f.db,f.actor,{operation:"ALLOCATE",...f.base,storefrontId:foreign.id,quantity:6,reason:"Fixture"});
  const [assigned]=await f.db.select().from(allocations).where(eq(allocations.storefrontId,foreign.id));
  const line={...f.line,allocationId:assigned!.id};
  await f.apply([{...line,type:"RESERVE",quantity:2,paymentMethod:"CARD"},{...line,type:"COMMIT",quantity:1}]);
  await expect(setEntityRelationship(f.db,f.actor,{...pair,mode:"PURCHASE"})).rejects.toMatchObject({details:{blockedReason:"RELATIONSHIP_HELD_UNITS"}});
  await f.apply([{...line,type:"RESERVATION_RELEASE",quantity:1},{...line,type:"COMMIT_RELEASE",quantity:1}]);
  await applyAdvancedStockOperation(f.db,f.actor,{operation:"DEALLOCATE",...f.base,storefrontId:foreign.id,quantity:6,reason:"Drain"});
  await applyAdvancedStockOperation(f.db,f.actor,{operation:"STOCK_OUT",...f.base,quantity:6,reason:"Drain"});
  await setEntityRelationship(f.db,f.actor,{...pair,mode:"PURCHASE"});
  await applyAdvancedStockOperation(f.db,f.actor,{operation:"STOCK_IN",...f.base,quantity:2,reason:"Purchase stock"});
  await expect(applyAdvancedStockOperation(f.db,f.actor,{operation:"TRANSFER_PURCHASE",...f.base,targetPoolId:f.pools[1]!.id,quantity:2,reason:"Purchase"})).rejects.toThrow(/document/);
  const result=await applyAdvancedStockOperation(f.db,f.actor,{operation:"TRANSFER_PURCHASE",...f.base,targetPoolId:f.pools[1]!.id,quantity:2,reason:"Purchase",documentRef:"WB-1"});
  expect(result.rows).toMatchObject([{relationshipMode:"PURCHASE",documentRef:"WB-1"},{relationshipMode:"PURCHASE",documentRef:"WB-1"}]);
});

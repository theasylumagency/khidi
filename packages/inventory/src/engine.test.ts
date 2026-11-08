import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { allocationBalances, allocations, auditLogs, createMigratorPool, entityRelationships, outboxEvents, poolSkuBalances, stockLedger, users, userEntityMemberships, accountingMappings } from "@khidi/db";
import { executeIdempotent } from "@khidi/domain";
import { createUuidV7 } from "@khidi/shared";
import { applyStockMovements } from "./engine.ts";
import { LEDGER_MOVEMENT_TYPES, type StockMovement } from "./types.ts";
import { MOVEMENT_MATRIX } from "./matrix.ts";
import { inventoryFixture } from "./test-fixture.ts";

it("covers exactly the 15 approved types, including every C3/C14 variant",()=>{
  expect(new Set(MOVEMENT_MATRIX.map((r)=>r.type))).toEqual(new Set(LEDGER_MOVEMENT_TYPES));
  expect(MOVEMENT_MATRIX).toHaveLength(20);
});

for(const rule of MOVEMENT_MATRIX) it(`applies and guards ${rule.type}/${rule.variant} (${rule.precondition})`,async()=>{
  const f=await inventoryFixture();
  const cod=rule.variant === "STAGING_RESERVED";
  await f.apply([{...f.line,type:"RESERVE",quantity:20,paymentMethod:cod?"CASH_ON_DELIVERY":"CARD"},
    ...(cod?[]:[{...f.line,type:"COMMIT" as const,quantity:10}]),{...f.line,type:"PICK_TO_STAGING",quantity:5}]);
  let m:StockMovement={...f.base,...(rule.allocation?f.line:{}),type:rule.type,variant:rule.variant,quantity:3,reason:"Approved fixture correction",
    approvedCountLineId:createUuidV7(),scanConfirmed:true,cancelLostLine:true,paymentMethod:"CARD"};
  let batch=[m];
  if(rule.type.startsWith("TRANSFER_")) {
    const transferKey=createUuidV7();
    let out={...m,type:"TRANSFER_OUT" as const,transferKey},into={...m,type:"TRANSFER_IN" as const,transferKey};
    if(rule.variant === "SAME_POOL") into={...into,allocationId:f.as[1]!.id};
    else {
      await f.db.insert(entityRelationships).values({id:createUuidV7(),fromEntityId:f.entities[0]!.id,toEntityId:f.entities[1]!.id,mode:"PURCHASE",effectiveFrom:new Date(0)});
      into={...into,poolId:f.pools[1]!.id,documentRef:"waybill-1"}; out={...out,documentRef:"waybill-1"};
    }
    batch=[out,into]; m=rule.type === "TRANSFER_OUT"?out:into;
  }
  const invalid={...m};
  if(rule.precondition === "NONE") invalid.quantity=0;
  else if(rule.precondition === "COUNT" || rule.precondition === "NEGATIVE_COUNT") delete invalid.approvedCountLineId;
  else if(rule.precondition === "TRANSFER_IN") { /* an unpaired IN must fail */ }
  else if(rule.precondition === "RETURN") invalid.scanConfirmed=false;
  else if(rule.precondition.startsWith("LOST")) invalid.cancelLostLine=false;
  else invalid.quantity=1000;
  const before=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
  const invalidBatch = rule.type === "TRANSFER_OUT" ? batch.map((leg)=>({...leg,quantity:1000})) : [invalid];
  await expect(f.apply(invalidBatch)).rejects.toThrow();
  if(rule.precondition.startsWith("LOST")) await expect(f.apply([{...m,quantity:1000}])).rejects.toThrow();
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id))).toHaveLength(before.length);
  const result=await f.apply(batch);
  expect(result.status).toBe("APPLIED");
  const row=result.rows.find((row)=>row.movementType === rule.type)!;
  expect([row.shelfDelta,row.stagingDelta,row.allocTotalDelta,row.allocatedDelta,row.reservedDelta,row.committedDelta]).toEqual(rule.deltas.map((d)=>d*3));
  expect(await f.db.select().from(auditLogs).where(eq(auditLogs.entityId,row.id))).toHaveLength(1);
  expect(await f.db.select().from(outboxEvents).where(and(eq(outboxEvents.correlationId,row.correlationId),eq(outboxEvents.eventType,"STOCK_CHANGED")))).toHaveLength(batch.length);
});

it("serializes the last unallocated unit and the last available reservation",async()=>{
  const f=await inventoryFixture(false);
  await f.apply([{...f.base,type:"STOCK_IN",quantity:1}]);
  const results=await Promise.allSettled([f.apply([{...f.base,type:"STOCK_OUT",quantity:1,reason:"Return"}]),f.apply([{...f.line,type:"ALLOCATE",quantity:1}])]);
  expect(results.filter((r)=>r.status === "fulfilled")).toHaveLength(1);
  const g=await inventoryFixture(false);
  await g.apply([{...g.base,type:"STOCK_IN",quantity:1},{...g.line,type:"ALLOCATE",quantity:1}]);
  const reservations=await Promise.allSettled([0,1].map(()=>g.apply([{...g.line,reservationId:createUuidV7(),type:"RESERVE",quantity:1,paymentMethod:"CARD"}])));
  expect(reservations.filter((r)=>r.status === "fulfilled")).toHaveLength(1);
  expect((await g.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,g.line.allocationId)))[0]).toMatchObject({reserved:1,availableToSell:0});
});

it("Rule A proposes explicit deallocation, applies the selected rows atomically, and persists a CRITICAL review for missing held units",async()=>{
  const f=await inventoryFixture();
  const adjustment:StockMovement={...f.base,type:"ADJUSTMENT",variant:"SHELF_DECREASE",quantity:50,approvedCountLineId:createUuidV7(),reason:"Count shortfall"};
  const proposed=await f.apply([adjustment]);
  expect(proposed).toMatchObject({status:"REQUIRES_DEALLOCATION",rows:[],plan:{needed:10,candidates:[{allocationId:f.line.allocationId,availableToSell:60}]}});
  const applied=await f.apply([{...f.line,type:"DEALLOCATE",quantity:10},adjustment]);
  expect(applied.status).toBe("APPLIED");
  await f.apply([{...f.line,type:"RESERVE",quantity:50,paymentMethod:"CARD"}]);
  const critical=await f.apply([{...adjustment,quantity:1}]);
  expect(critical).toMatchObject({status:"CRITICAL",rows:[]});
  expect(await f.db.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId,f.sku.id),eq(outboxEvents.eventType,"STOCK_REVIEW_REQUIRED")))).toMatchObject([{payloadJson:{severity:"CRITICAL"}}]);
});

it("Rule B rejects unpaired legs, invalid directions, missing documents and absent/future relationships",async()=>{
  const f=await inventoryFixture();
  const cross=()=>f.apply([{...f.base,type:"TRANSFER_OUT",variant:"CROSS_POOL",quantity:2,transferKey:"x",documentRef:"doc"},{...f.base,poolId:f.pools[1]!.id,type:"TRANSFER_IN",variant:"CROSS_POOL",quantity:2,transferKey:"x",documentRef:"doc"}]);
  await expect(cross()).rejects.toThrow(/PURCHASE/);
  await f.db.insert(entityRelationships).values({id:createUuidV7(),fromEntityId:f.entities[0]!.id,toEntityId:f.entities[1]!.id,mode:"PURCHASE",effectiveFrom:new Date(Date.now()+86400000)});
  await expect(cross()).rejects.toThrow(/PURCHASE/);
  await f.db.insert(entityRelationships).values({id:createUuidV7(),fromEntityId:f.entities[0]!.id,toEntityId:f.entities[1]!.id,mode:"PURCHASE",effectiveFrom:new Date(0)});
  await expect(f.apply([{...f.base,type:"TRANSFER_OUT",variant:"CROSS_POOL",quantity:2,transferKey:"x"},{...f.base,poolId:f.pools[1]!.id,type:"TRANSFER_IN",variant:"CROSS_POOL",quantity:2,transferKey:"x"}])).rejects.toThrow(/document/);
  await cross();
  await expect(f.db.insert(allocations).values({id:createUuidV7(),...f.base,storefrontId:f.stores[2]!.id})).rejects.toMatchObject({cause:{message:expect.stringMatching(/CONSIGNMENT/)}});
  await f.db.insert(entityRelationships).values({id:createUuidV7(),fromEntityId:f.entities[0]!.id,toEntityId:f.entities[1]!.id,mode:"CONSIGNMENT",effectiveFrom:new Date(1)});
  const [a]=await f.db.insert(allocations).values({id:createUuidV7(),...f.base,storefrontId:f.stores[2]!.id}).returning();
  const moved=await f.apply([{...f.base,allocationId:a!.id,type:"ALLOCATE",quantity:3}]);
  expect(moved.rows[0]).toMatchObject({crossEntity:true,relationshipMode:"CONSIGNMENT",ownerEntityId:f.entities[0]!.id,sellerEntityId:f.entities[1]!.id});
  const reallocated=await f.apply([{...f.line,type:"TRANSFER_OUT",variant:"SAME_POOL",quantity:2,transferKey:"consign"},
    {...f.base,allocationId:a!.id,type:"TRANSFER_IN",variant:"SAME_POOL",quantity:2,transferKey:"consign"}]);
  expect(reallocated.rows).toHaveLength(2);
  for(const row of reallocated.rows) expect(row).toMatchObject({crossEntity:true,relationshipMode:"CONSIGNMENT"});
});

it("keeps partial picks held until scan-confirmed return, and commits COD together with handover",async()=>{
  const f=await inventoryFixture();
  await f.apply([{...f.line,type:"RESERVE",quantity:4,paymentMethod:"CASH_ON_DELIVERY"},{...f.line,type:"PICK_TO_STAGING",quantity:2}]);
  await expect(f.apply([{...f.line,type:"RESERVATION_RELEASE",quantity:3}])).rejects.toThrow(/staged/);
  await expect(f.apply([{...f.line,type:"HANDOVER_OUT",quantity:2}])).rejects.toThrow(/commitments/);
  await expect(f.apply([{...f.line,type:"COMMIT",quantity:2}])).rejects.toThrow(/handover/);
  await f.apply([{...f.line,type:"RESERVATION_RELEASE",quantity:2}]);
  await f.apply([{...f.line,type:"COMMIT",quantity:2},{...f.line,type:"HANDOVER_OUT",quantity:2}]);
  await expect(f.apply([{...f.line,type:"HANDOVER_OUT",quantity:1}])).rejects.toThrow();
  await expect(f.apply([{...f.line,type:"RETURN_TO_SHELF",quantity:1,scanConfirmed:true}])).rejects.toThrow();
});

it("does not borrow another reservation's units or another request's staged units",async()=>{
  const f=await inventoryFixture();
  await f.apply([{...f.line,type:"RESERVE",quantity:3,paymentMethod:"CARD"}]);
  await expect(f.apply([{...f.line,type:"PICK_TO_STAGING",quantity:1}])).rejects.toThrow(/committed/);
  await expect(f.apply([{...f.line,reservationId:createUuidV7(),type:"COMMIT",quantity:1}])).rejects.toThrow(/line/);
  await f.apply([{...f.line,type:"COMMIT",quantity:2},{...f.line,type:"PICK_TO_STAGING",quantity:2}]);
  await expect(f.apply([{...f.line,type:"COMMIT_RELEASE",quantity:1}])).rejects.toThrow(/staged/);
  await expect(f.apply([{...f.line,fulfillmentRequestId:createUuidV7(),type:"RETURN_TO_SHELF",quantity:1,scanConfirmed:true}])).rejects.toThrow(/request/);
  await expect(f.apply([{...f.line,fulfillmentRequestId:createUuidV7(),type:"HANDOVER_OUT",quantity:1}])).rejects.toThrow(/staged/);
  await f.apply([{...f.line,type:"RETURN_TO_SHELF",quantity:1,scanConfirmed:true},{...f.line,type:"COMMIT_RELEASE",quantity:1}]);
});

it("requires trusted workflow adapters for count approvals, scan returns and atomic lost-line cancellation",async()=>{
  const f=await inventoryFixture();
  const adjustment:StockMovement={...f.base,type:"ADJUSTMENT",variant:"SHELF_INCREASE",quantity:1,reason:"Approved count",approvedCountLineId:createUuidV7()};
  await expect(applyStockMovements(f.db,f.actor,[adjustment])).rejects.toThrow(/workflow/);
  await f.apply([{...f.line,type:"RESERVE",quantity:2,paymentMethod:"CARD"},{...f.line,type:"COMMIT",quantity:2},{...f.line,type:"PICK_TO_STAGING",quantity:2}]);
  const lost:StockMovement={...f.line,type:"ADJUSTMENT",variant:"STAGING_COMMITTED",quantity:1,reason:"Unit lost",cancelLostLine:true};
  await expect(applyStockMovements(f.db,f.actor,[lost])).rejects.toThrow(/same transaction/);
  await expect(applyStockMovements(f.db,f.actor,[{...f.line,type:"RETURN_TO_SHELF",quantity:1,scanConfirmed:true}])).rejects.toThrow(/workflow/);
  const before=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
  await expect(applyStockMovements(f.db,f.actor,[lost],{cancelLostFulfillmentLine:async(ctx)=>{
    await ctx.recordAudit({action:"FIXTURE_CANCEL",entityType:"sku",entityId:f.sku.id});
    throw new Error("Cancellation failed");
  }})).rejects.toThrow("Cancellation failed");
  expect(await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityId,f.sku.id),eq(auditLogs.action,"FIXTURE_CANCEL")))).toHaveLength(0);
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id))).toEqual(before);
});

it("enforces role/entity scope, reason and count approval; a failed batch rolls back ledger, audit and balances",async()=>{
  const f=await inventoryFixture();
  const [manager]=await f.db.insert(users).values({id:createUuidV7(),fullName:"Fixture",role:"STOCK_MANAGER"}).returning();
  const movement:StockMovement={...f.base,type:"STOCK_IN",quantity:1};
  await expect(applyStockMovements(f.db,{userId:manager!.id},[movement])).rejects.toMatchObject({code:"FORBIDDEN"});
  await f.db.insert(userEntityMemberships).values({userId:manager!.id,legalEntityId:f.entities[0]!.id});
  await applyStockMovements(f.db,{userId:manager!.id},[movement]);
  await expect(f.apply([{...f.base,type:"WRITE_OFF",quantity:1}])).rejects.toThrow(/reason/);
  const before=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
  await expect(f.apply([movement,{...f.base,type:"STOCK_OUT",quantity:1000,reason:"Invalid"}])).rejects.toThrow();
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id))).toEqual(before);
  const [balance]=await f.db.select().from(poolSkuBalances).where(eq(poolSkuBalances.poolId,f.base.poolId));
  expect(balance).toMatchObject({shelf:101,allocatedTotal:60});
});

it("snapshots accounting on COMMIT even after a mapping is disabled, and replays idempotently",async()=>{
  const f=await inventoryFixture();
  await f.db.insert(accountingMappings).values({id:createUuidV7(),skuId:f.sku.id,legalEntityId:f.entities[0]!.id,accountingItemId:"item-1",accountingName:"Mapped fixture",active:false});
  await f.apply([{...f.line,type:"RESERVE",quantity:2,paymentMethod:"CARD"}]);
  const key=createUuidV7(), movements:StockMovement[]=[{...f.line,type:"COMMIT",quantity:2}];
  const commit=()=>executeIdempotent(f.db,{scope:"inventory-fixture",idempotencyKey:key,payload:movements},async(tx)=>({status:200,body:await applyStockMovements(tx,f.actor,movements)}));
  await commit(); expect((await commit()).replayed).toBe(true);
  const rows=await f.db.select().from(stockLedger).where(and(eq(stockLedger.skuId,f.sku.id),eq(stockLedger.movementType,"COMMIT")));
  expect(rows).toMatchObject([{sellerAccountingItemId:"item-1",ownerAccountingItemId:"item-1",sellerAccountingName:"Mapped fixture"}]);
});

it("enforces stock ledger append-only through both application grants and owner triggers",async()=>{
  const f=await inventoryFixture();
  const [row]=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
  await expect(f.db.update(stockLedger).set({quantity:1}).where(eq(stockLedger.id,row!.id))).rejects.toThrow();
  await expect(f.db.delete(stockLedger).where(eq(stockLedger.id,row!.id))).rejects.toThrow();
  const pool=createMigratorPool();
  try {
    await expect(pool.query("UPDATE stock_ledger SET quantity=1 WHERE id=$1",[row!.id])).rejects.toThrow(/append.only/i);
    await expect(pool.query("DELETE FROM stock_ledger WHERE id=$1",[row!.id])).rejects.toThrow(/append.only/i);
  } finally {await pool.end();}
});

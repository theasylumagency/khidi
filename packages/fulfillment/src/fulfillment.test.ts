import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { accountingMappings, allocationBalances, auditLogs, bundleComponents, fulfillmentHistory, fulfillmentLines, fulfillmentRequests, outboxEvents, poolSkuBalances, reservationLines, reservations, scanTasks, stockLedger, storefrontApiKeys, storefrontListings, unitConfirmations, users } from "@khidi/db";
import { getFulfillmentMode, setFulfillmentMode, type FulfillmentMode } from "@khidi/reservations";
import { createUuidV7 } from "@khidi/shared";
import { applyWorkflowStockMovements } from "@khidi/inventory/workflow";
import { applyStockMovements } from "@khidi/inventory";
import { withdrawPrice } from "../../pricing/src/index.ts";
import { reservationFixture } from "../../reservations/src/reservation.test-fixture.ts";
import { reserveOrder, confirmOrder, releaseOrder, confirmFulfillmentUnit, handoverOrder, cancelFulfillment, markLostInStaging } from "./index.ts";

type Fixture=Awaited<ReturnType<typeof reservationFixture>>;
const staff=(f:Fixture)=>({type:"USER" as const,userId:f.actor.userId});
const confirmation=(skuId:string)=>({deliveryMethod:"COURIER",shipBy:"2030-01-01",prices:[{skuId,finalUnitPriceMinor:12345,currency:"GEL"}]});
async function open(f:Fixture,paymentMethod="CARD",mode:FulfillmentMode="CONTROLLED_FULFILLMENT",quantity=2,skuId=f.sku.id) {
  await setFulfillmentMode(f.db,staff(f),createUuidV7(),{mode});
  const c=confirmation(skuId),cod=["CASH_ON_DELIVERY","PAY_ON_PICKUP"].includes(paymentMethod);
  const reserve=await reserveOrder(f.db,f.principal,createUuidV7(),{storefrontOrderRef:"O-123456789",paymentMethod,items:[{skuId,quantity}],...(cod ? {confirmation:c} : {})});
  return cod ? reserve : confirmOrder(f.db,f.principal,createUuidV7(),{reservationId:reserve.body.reservationId,confirmation:c});
}
async function lines(f:Fixture,id:string) {return f.db.select().from(fulfillmentLines).where(eq(fulfillmentLines.fulfillmentRequestId,id));}
async function unit(f:Fixture,id:string,lineId:string,action="PICK",manual=false,p=staff(f)) {
  return confirmFulfillmentUnit(f.db,p,createUuidV7(),{fulfillmentRequestId:id,lineId,action,
    confirmation:manual ? {method:"MANUAL",reason:"Specific unit label is missing"} : {method:"SCAN",identifier:f.sku.internalSku}});
}

for(const payment of ["CARD","BANK_INSTALLMENT","CASH_ON_DELIVERY","PAY_ON_PICKUP"]) it(`completes ${payment} with identical balances in both modes, preserving actual provenance`,async()=>{
  const final=[];
  for(const mode of ["SIMPLIFIED_FULFILLMENT","CONTROLLED_FULFILLMENT"] as const) {
    const f=await reservationFixture(),result=await open(f,payment,mode),id=result.body.fulfillmentRequestId!;
    expect(result.body.status).toBe(mode==="SIMPLIFIED_FULFILLMENT" ? "HANDED_OVER" : "REQUESTED");
    expect(result.body).not.toHaveProperty("fulfillmentMode");
    if(mode==="CONTROLLED_FULFILLMENT") {
      const [line]=await lines(f,id);
      for(let i=0;i<2;i++) await unit(f,id,line!.id);
      await handoverOrder(f.db,staff(f),createUuidV7(),{fulfillmentRequestId:id});
    } else {
      expect(await f.db.select().from(scanTasks).where(eq(scanTasks.fulfillmentRequestId,id))).toHaveLength(0);
      const movements=await f.db.select().from(stockLedger).where(and(eq(stockLedger.reservationId,result.body.reservationId!),eq(stockLedger.actorType,"SYSTEM_WORKFLOW")));
      expect(movements.map((m)=>m.movementType)).toEqual(["CASH_ON_DELIVERY","PAY_ON_PICKUP"].includes(payment) ? ["PICK_TO_STAGING","COMMIT","HANDOVER_OUT"] : ["COMMIT","PICK_TO_STAGING","HANDOVER_OUT"]);
      for(const m of movements) expect(m).toMatchObject({actorUserId:null,actorId:"SIMPLIFIED_FULFILLMENT",triggerApiKeyId:f.principal.apiKeyId,scanConfirmed:false});
      const history=await f.db.select().from(fulfillmentHistory).where(eq(fulfillmentHistory.fulfillmentRequestId,id));
      expect(history).toContainEqual(expect.objectContaining({actorType:"SYSTEM_WORKFLOW",confirmation:"AUTO_ASSUMED",toStatus:"HANDED_OVER",triggerApiKeyId:f.principal.apiKeyId}));
      expect(await f.db.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId,id),eq(outboxEvents.eventType,"FULFILLMENT_STATUS_CHANGED"))))
        .toContainEqual(expect.objectContaining({payloadJson:expect.objectContaining({status:"HANDED_OVER",confirmation:"AUTO_ASSUMED",schemaVersion:1})}));
    }
    const [balance]=await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[0]!.id));
    const [pool]=await f.db.select().from(poolSkuBalances).where(and(eq(poolSkuBalances.poolId,f.pool.id),eq(poolSkuBalances.skuId,f.sku.id)));
    final.push({allocated:balance!.allocated,reserved:balance!.reserved,committed:balance!.committed,available:balance!.availableToSell,shelf:pool!.shelf,staging:pool!.staging});
    await expect(releaseOrder(f.db,f.principal,createUuidV7(),{reservationId:result.body.reservationId,reason:"Too late"})).rejects.toThrow(/closed/);
    await expect(cancelFulfillment(f.db,staff(f),createUuidV7(),{fulfillmentRequestId:id,reason:"Too late"})).rejects.toThrow(/closed/);
  }
  expect(final).toEqual([{allocated:58,reserved:0,committed:0,available:58,shelf:98,staging:0},{allocated:58,reserved:0,committed:0,available:58,shelf:98,staging:0}]);
},30000);

it("freezes mode per reservation; duplicate and concurrent confirmations move stock once",async()=>{
  const f=await reservationFixture();
  await setFulfillmentMode(f.db,staff(f),createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
  const r=await reserveOrder(f.db,f.principal,createUuidV7(),{storefrontOrderRef:"C-1",paymentMethod:"CARD",items:[{skuId:f.sku.id,quantity:2}]});
  await setFulfillmentMode(f.db,staff(f),createUuidV7(),{mode:"CONTROLLED_FULFILLMENT"});
  const key=createUuidV7(),payload={reservationId:r.body.reservationId,confirmation:confirmation(f.sku.id)};
  const [a,b]=await Promise.all([confirmOrder(f.db,f.principal,key,payload),confirmOrder(f.db,f.principal,key,payload)]);
  expect(a.body).toEqual(b.body);expect(a.body.status).toBe("HANDED_OVER");
  expect((await confirmOrder(f.db,f.principal,key,payload)).replayed).toBe(true);
  const rows=await f.db.select().from(stockLedger).where(eq(stockLedger.reservationId,r.body.reservationId!));
  expect(rows.map((m)=>m.movementType)).toEqual(["RESERVE","COMMIT","PICK_TO_STAGING","HANDOVER_OUT"]);
  const second=await open(f,"CARD","CONTROLLED_FULFILLMENT");expect(second.body.status).toBe("REQUESTED");
  await setFulfillmentMode(f.db,staff(f),createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
  const [line]=await lines(f,second.body.fulfillmentRequestId!);
  await unit(f,second.body.fulfillmentRequestId!,line!.id);await unit(f,second.body.fulfillmentRequestId!,line!.id);
  expect((await handoverOrder(f.db,staff(f),createUuidV7(),{fulfillmentRequestId:second.body.fulfillmentRequestId})).body.status).toBe("HANDED_OVER");
  await expect(getFulfillmentMode(f.db,f.principal as unknown as ReturnType<typeof staff>)).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(setFulfillmentMode(f.db,f.principal as unknown as ReturnType<typeof staff>,createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"})).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("refuses another storefront's valid key without exposing or changing its reservation",async()=>{
  const f=await reservationFixture(),r=await reserveOrder(f.db,f.principal,createUuidV7(),{storefrontOrderRef:"SCOPE-1",paymentMethod:"CARD",items:[{skuId:f.sku.id,quantity:2}]});
  const [key]=await f.db.insert(storefrontApiKeys).values({id:createUuidV7(),storefrontId:f.stores[1]!.id,name:"Other store fixture",keyPrefix:"m9-other",keyHash:createUuidV7()}).returning();
  const other={type:"STOREFRONT_SERVICE" as const,storefrontId:f.stores[1]!.id,apiKeyId:key!.id};
  const before=await f.db.select().from(stockLedger).where(eq(stockLedger.reservationId,r.body.reservationId!));
  await expect(confirmOrder(f.db,other,createUuidV7(),{reservationId:r.body.reservationId,confirmation:confirmation(f.sku.id)})).rejects.toMatchObject({code:"NOT_FOUND"});
  await expect(releaseOrder(f.db,other,createUuidV7(),{reservationId:r.body.reservationId,reason:"Wrong store"})).rejects.toMatchObject({code:"NOT_FOUND"});
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.reservationId,r.body.reservationId!))).toEqual(before);
});

it("requires a correct unit scan or authorized manual confirmation with a reason and the assigned warehouse task",async()=>{
  const f=await reservationFixture(),r=await open(f),id=r.body.fulfillmentRequestId!,[line]=await lines(f,id);
  const [warehouse]=await f.db.insert(users).values({id:createUuidV7(),fullName:"Warehouse fixture",role:"WAREHOUSE"}).returning();
  const worker={type:"USER" as const,userId:warehouse!.id};
  await expect(unit(f,id,line!.id,"PICK",true,worker)).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(confirmFulfillmentUnit(f.db,staff(f),createUuidV7(),{fulfillmentRequestId:id,lineId:line!.id,action:"PICK",confirmation:{method:"MANUAL",reason:" "}})).rejects.toThrow(/Invalid/);
  const other=await f.extraSku();
  await expect(confirmFulfillmentUnit(f.db,worker,createUuidV7(),{fulfillmentRequestId:id,lineId:line!.id,action:"PICK",confirmation:{method:"SCAN",identifier:other.sku.internalSku}})).rejects.toThrow(/another SKU/);
  await f.db.update(scanTasks).set({assigneeRole:null,assigneeUserId:f.actor.userId}).where(eq(scanTasks.fulfillmentRequestId,id));
  await expect(unit(f,id,line!.id,"PICK",false,worker)).rejects.toMatchObject({code:"FORBIDDEN"});
  await f.db.update(scanTasks).set({assigneeUserId:worker.userId}).where(eq(scanTasks.fulfillmentRequestId,id));
  await unit(f,id,line!.id,"PICK",false,worker);
  const [manager]=await f.db.insert(users).values({id:createUuidV7(),fullName:"Order fixture",role:"ORDER_MANAGER"}).returning();
  await unit(f,id,line!.id,"PICK",true,{type:"USER",userId:manager!.id});
  expect(await f.db.select().from(unitConfirmations).where(eq(unitConfirmations.fulfillmentRequestId,id))).toMatchObject([
    {method:"SCAN",actorUserId:worker.userId},{method:"MANUAL",actorUserId:manager!.id,reason:"Specific unit label is missing"}
  ]);
});

for(const payment of ["CARD","CASH_ON_DELIVERY"]) it(`cancels partial ${payment} picks without releasing staging and returns each unit before release`,async()=>{
  const f=await reservationFixture(),r=await open(f,payment,"CONTROLLED_FULFILLMENT",3),id=r.body.fulfillmentRequestId!,[line]=await lines(f,id);
  await unit(f,id,line!.id);
  const cancelled=await cancelFulfillment(f.db,staff(f),createUuidV7(),{fulfillmentRequestId:id,reason:"Order cancelled"});
  expect(cancelled.body.requiresReturnToShelf).toBe(true);
  expect((await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[0]!.id)))[0]).toMatchObject(payment==="CARD" ? {committed:1,reserved:0} : {committed:0,reserved:1});
  await unit(f,id,line!.id,"RETURN",true);
  expect((await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[0]!.id)))[0]).toMatchObject({committed:0,reserved:0,availableToSell:60});
  expect((await f.db.select().from(reservations).where(eq(reservations.id,r.body.reservationId!)))[0]!.status).toBe("RELEASED");
  expect((await f.db.select().from(fulfillmentRequests).where(eq(fulfillmentRequests.id,id)))[0]).toMatchObject({status:"CANCELLED",requiresReturnToShelf:false});
});

for(const payment of ["CARD","CASH_ON_DELIVERY"]) it(`handles lost ${payment} staging through the ADMIN-only atomic cancellation hook`,async()=>{
  const f=await reservationFixture(),r=await open(f,payment),id=r.body.fulfillmentRequestId!,[line]=await lines(f,id);
  await unit(f,id,line!.id);await unit(f,id,line!.id);
  const [manager]=await f.db.insert(users).values({id:createUuidV7(),fullName:"Fixture",role:"ORDER_MANAGER"}).returning();
  const payload={fulfillmentRequestId:id,lineId:line!.id,reason:"Specific staged unit missing"};
  await expect(markLostInStaging(f.db,{type:"USER",userId:manager!.id},createUuidV7(),payload)).rejects.toMatchObject({code:"FORBIDDEN"});
  const result=await markLostInStaging(f.db,staff(f),createUuidV7(),payload);
  expect(result.body.requiresReturnToShelf).toBe(true);
  expect(await f.db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId,id)))
    .toContainEqual(expect.objectContaining({payloadJson:expect.objectContaining({status:"CANCELLED",reason:"UNIT_LOST"})}));
  await unit(f,id,line!.id,"RETURN");
  expect((await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[0]!.id)))[0]).toMatchObject({allocated:59,reserved:0,committed:0,availableToSell:59});
  expect((await lines(f,id))[0]).toMatchObject({lostQuantity:1,returnedQuantity:1});
});

it("automatically fulfills bundle snapshot lines and rejects a failed confirmation atomically",async()=>{
  const f=await reservationFixture(),bundle=await f.bundle();
  const r=await open(f,"CASH_ON_DELIVERY","SIMPLIFIED_FULFILLMENT",2,bundle.sku.id);
  expect(r.body).toMatchObject({status:"HANDED_OVER",confirmation:"AUTO_ASSUMED"});
  expect((await lines(f,r.body.fulfillmentRequestId!)).map((l)=>l.handedOverQuantity).sort()).toEqual([4,6]);
  const before=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
  await expect(reserveOrder(f.db,f.principal,createUuidV7(),{storefrontOrderRef:"BAD-1",paymentMethod:"CASH_ON_DELIVERY",items:[{skuId:f.sku.id,quantity:1}],confirmation:confirmation(createUuidV7())})).rejects.toThrow();
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id))).toEqual(before);
  const pending=await reserveOrder(f.db,f.principal,createUuidV7(),{storefrontOrderRef:"FAILED-1",paymentMethod:"CARD",items:[{skuId:f.sku.id,quantity:1}]});
  await releaseOrder(f.db,f.principal,createUuidV7(),{reservationId:pending.body.reservationId,reason:"PAYMENT_FAILED"});
  expect(await f.db.select().from(fulfillmentRequests).where(eq(fulfillmentRequests.reservationId,pending.body.reservationId!))).toHaveLength(0);
  expect(await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityId,r.body.fulfillmentRequestId!),eq(auditLogs.actorType,"SYSTEM_WORKFLOW"))))
    .toContainEqual(expect.objectContaining({triggerApiKeyId:f.principal.apiKeyId}));
});
it("lets ADMIN record another actually lost staged unit while cancellation still awaits its return",async()=>{
  const f=await reservationFixture(),r=await open(f,"CASH_ON_DELIVERY"),id=r.body.fulfillmentRequestId!,[line]=await lines(f,id);
  await unit(f,id,line!.id);await unit(f,id,line!.id);
  const payload={fulfillmentRequestId:id,lineId:line!.id,reason:"Missing staged unit"};
  await markLostInStaging(f.db,staff(f),createUuidV7(),payload);
  const last=await markLostInStaging(f.db,staff(f),createUuidV7(),payload);
  expect(last.body.requiresReturnToShelf).toBe(false);
  expect((await lines(f,id))[0]).toMatchObject({lostQuantity:2,returnedQuantity:0});
  expect((await f.db.select().from(reservations).where(eq(reservations.id,r.body.reservationId!)))[0]!.status).toBe("RELEASED");
});

it("does not reuse a unit confirmation, within the same transaction or after it commits",async()=>{
  const f=await reservationFixture(),r=await open(f),id=r.body.fulfillmentRequestId!,[line]=await lines(f,id);
  const base={poolId:f.pool.id,skuId:f.sku.id,allocationId:f.as[0]!.id,reservationId:r.body.reservationId!,reservationLineId:line!.reservationLineId,
    fulfillmentRequestId:id,type:"PICK_TO_STAGING" as const,quantity:1};
  const before=await f.db.select().from(stockLedger).where(eq(stockLedger.reservationId,r.body.reservationId!));
  await expect(f.db.transaction(async(tx)=>{
    const proofId=createUuidV7();
    await tx.insert(unitConfirmations).values({id:proofId,reservationId:r.body.reservationId!,reservationLineId:line!.reservationLineId,fulfillmentRequestId:id,
      skuId:f.sku.id,allocationId:f.as[0]!.id,action:"PICK_TO_STAGING",method:"SCAN",quantity:1,actorUserId:f.actor.userId,scannedIdentifier:f.sku.internalSku});
    const m={...base,unitConfirmationIds:[proofId]};await applyWorkflowStockMovements(tx,staff(f),[m,m]);
  })).rejects.toThrow(/duplicate/);
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.reservationId,r.body.reservationId!))).toEqual(before);
  await unit(f,id,line!.id);
  const [proof]=await f.db.select().from(unitConfirmations).where(eq(unitConfirmations.fulfillmentRequestId,id));
  await expect(applyWorkflowStockMovements(f.db,staff(f),[{...base,unitConfirmationIds:[proof!.id]}])).rejects.toThrow(/this transaction/);
});

it("automatically expands and completes bundles for every payment method",async()=>{
  const f=await reservationFixture(),bundle=await f.bundle();
  for(const payment of ["CARD","BANK_INSTALLMENT","CASH_ON_DELIVERY","PAY_ON_PICKUP"]) {
    const r=await open(f,payment,"SIMPLIFIED_FULFILLMENT",1,bundle.sku.id);
    expect(r.body).toMatchObject({status:"HANDED_OVER",confirmation:"AUTO_ASSUMED"});
    expect((await lines(f,r.body.fulfillmentRequestId!)).map((l)=>l.handedOverQuantity).sort()).toEqual([2,3]);
  }
});

it("fulfills the original bundle and accounting snapshots after composition, listing, mapping and price changes",async()=>{
  const f=await reservationFixture(),bundle=await f.bundle();
  await setFulfillmentMode(f.db,staff(f),createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
  const input={storefrontOrderRef:"SNAP-1",paymentMethod:"CARD",items:[{skuId:bundle.sku.id,quantity:2}]};
  const r=await reserveOrder(f.db,f.principal,createUuidV7(),input);
  await f.db.update(bundleComponents).set({quantity:10}).where(eq(bundleComponents.bundleSkuId,bundle.sku.id));
  await f.db.update(accountingMappings).set({active:false,accountingName:"Changed later"}).where(eq(accountingMappings.skuId,bundle.second.sku.id));
  await f.db.update(storefrontListings).set({enabled:false}).where(eq(storefrontListings.skuId,bundle.sku.id));
  await withdrawPrice(f.db,f.actor,{skuId:bundle.sku.id,storefrontId:f.store.id},"Fixture withdrawal");
  await expect(reserveOrder(f.db,f.principal,createUuidV7(),input)).rejects.toThrow();
  const done=await confirmOrder(f.db,f.principal,createUuidV7(),{reservationId:r.body.reservationId,confirmation:confirmation(bundle.sku.id)});
  expect((await lines(f,done.body.fulfillmentRequestId!)).map((l)=>l.handedOverQuantity).sort()).toEqual([4,6]);
  expect(await f.db.select().from(stockLedger).where(and(eq(stockLedger.reservationId,r.body.reservationId!),eq(stockLedger.movementType,"COMMIT"))))
    .toMatchObject([{sellerAccountingName:"M9 fixture"},{sellerAccountingName:"M9 fixture"}]);
  const [snapshot]=await f.db.select().from(reservationLines).where(eq(reservationLines.reservationId,r.body.reservationId!));
  await expect(f.db.update(reservationLines).set({releasedQuantity:1}).where(eq(reservationLines.id,snapshot!.id))).rejects.toThrow(/Closed/);
  await expect(applyStockMovements(f.db,f.actor,[{poolId:f.pool.id,skuId:snapshot!.skuId,allocationId:snapshot!.allocationId,reservationId:r.body.reservationId!,type:"RESERVE",quantity:1,paymentMethod:"CARD"}])).rejects.toThrow(/Closed/);
});
it("fulfills overlapping bundle and ordinary lines without mixing their proofs or changing another storefront",async()=>{
  const f=await reservationFixture(),bundle=await f.bundle();
  await f.apply([{...f.base,allocationId:f.as[1]!.id,type:"ALLOCATE",quantity:20}]);
  const [other]=await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[1]!.id));
  await setFulfillmentMode(f.db,staff(f),createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
  const done=await reserveOrder(f.db,f.principal,createUuidV7(),{storefrontOrderRef:"MIXED-1",paymentMethod:"CASH_ON_DELIVERY",
    items:[{skuId:bundle.sku.id,quantity:2},{skuId:f.sku.id,quantity:3}],confirmation:{...confirmation(bundle.sku.id),
      prices:[...confirmation(bundle.sku.id).prices,...confirmation(f.sku.id).prices]}});
  expect(done.body.status).toBe("HANDED_OVER");
  const physical=await lines(f,done.body.fulfillmentRequestId!);
  expect(physical).toHaveLength(3);expect(new Set(physical.map((l)=>l.reservationLineId)).size).toBe(3);
  expect(physical.filter((l)=>l.skuId===f.sku.id).map((l)=>l.handedOverQuantity).sort()).toEqual([3,4]);
  expect((await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[0]!.id)))[0]).toMatchObject({allocated:53,reserved:0,committed:0});
  expect((await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[1]!.id)))[0]).toEqual(other);
});

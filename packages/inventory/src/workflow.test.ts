import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { accountingMappings, auditLogs, reservationLines, reservations, stockLedger, storefrontApiKeys, unitConfirmations, users } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import { inventoryFixture } from "./test-fixture.ts";
import { applyStockMovements } from "./engine.ts";
import { applyWorkflowStockMovements } from "./workflow.ts";

for(const paymentMethod of ["CARD","BANK_INSTALLMENT"]) it(`never lets a USER commit ${paymentMethod}, even with a handover in the command`,async()=>{
  const f=await inventoryFixture();await f.apply([{...f.line,type:"RESERVE",quantity:2,paymentMethod:paymentMethod as "CARD"|"BANK_INSTALLMENT"}]);
  const [line]=await f.db.select().from(reservationLines).where(eq(reservationLines.reservationId,f.line.reservationId));
  const base={...f.line,reservationLineId:line!.id,quantity:1},p={type:"USER" as const,userId:f.actor.userId};
  for(const batch of [[{...base,type:"COMMIT" as const}],[{...base,type:"COMMIT" as const},{...base,type:"HANDOVER_OUT" as const}]])
    await expect(applyWorkflowStockMovements(f.db,p,batch)).rejects.toMatchObject({code:"FORBIDDEN"});
  expect(await f.db.select().from(stockLedger).where(and(eq(stockLedger.reservationId,f.line.reservationId),eq(stockLedger.movementType,"COMMIT")))).toHaveLength(0);
});
for(const paymentMethod of ["CASH_ON_DELIVERY","PAY_ON_PICKUP"]) it(`allows USER ${paymentMethod} COMMIT only with the matching controlled handover`,async()=>{
  const f=await inventoryFixture();await f.apply([{...f.line,type:"RESERVE",quantity:2,paymentMethod:paymentMethod as "CASH_ON_DELIVERY"|"PAY_ON_PICKUP"},{...f.line,type:"PICK_TO_STAGING",quantity:2}]);
  const [line]=await f.db.select().from(reservationLines).where(eq(reservationLines.reservationId,f.line.reservationId));
  const base={...f.line,reservationLineId:line!.id,quantity:1},commit={...base,type:"COMMIT" as const},handover={...base,type:"HANDOVER_OUT" as const},p={type:"USER" as const,userId:f.actor.userId};
  await expect(applyWorkflowStockMovements(f.db,p,[commit])).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(applyWorkflowStockMovements(f.db,p,[commit,{...handover,quantity:2}])).rejects.toMatchObject({code:"FORBIDDEN"});
  expect((await applyWorkflowStockMovements(f.db,p,[commit,handover])).rows.map((r)=>r.movementType)).toEqual(["COMMIT","HANDOVER_OUT"]);
});

it("requires genuine unit records even for ADMIN; bare scan booleans and no-op hooks cannot authorize picking or returning",async()=>{
  const f=await inventoryFixture();
  await f.apply([{...f.line,type:"RESERVE",quantity:2,paymentMethod:"CARD"},{...f.line,type:"COMMIT",quantity:2}]);
  await expect(applyStockMovements(f.db,f.actor,[{...f.line,type:"PICK_TO_STAGING",quantity:1,scanConfirmed:true}],f.proofs)).rejects.toThrow(/confirmation/);
  await f.apply([{...f.line,type:"PICK_TO_STAGING",quantity:1}]);
  await expect(applyStockMovements(f.db,f.actor,[{...f.line,type:"RETURN_TO_SHELF",quantity:1,scanConfirmed:true}],f.proofs)).rejects.toThrow(/confirmation/);
});

it("limits storefront workflow rights and writes the real key to ledger and audit",async()=>{
  const f=await inventoryFixture();
  await f.apply([{...f.line,type:"RESERVE",quantity:2,paymentMethod:"CARD"}]);
  const [header]=await f.db.select().from(reservations).where(eq(reservations.id,f.line.reservationId));
  const [line]=await f.db.select().from(reservationLines).where(eq(reservationLines.reservationId,header!.id));
  const principal={type:"STOREFRONT_SERVICE" as const,apiKeyId:header!.createdByApiKeyId,storefrontId:header!.storefrontId};
  for(const type of ["PICK_TO_STAGING","HANDOVER_OUT","STOCK_IN"] as const)
    await expect(applyWorkflowStockMovements(f.db,principal,[{...f.line,reservationLineId:line!.id,type,quantity:1}])).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(applyWorkflowStockMovements(f.db,{...principal,storefrontId:f.stores[1]!.id},[{...f.line,type:"COMMIT",quantity:1}])).rejects.toMatchObject({code:"FORBIDDEN"});
  await f.db.update(accountingMappings).set({accountingName:"Changed later"}).where(eq(accountingMappings.id,line!.sellerMappingId));
  const result=await applyWorkflowStockMovements(f.db,principal,[{...f.line,reservationLineId:line!.id,type:"COMMIT",quantity:1}]);
  expect(result.rows[0]).toMatchObject({actorUserId:null,actorType:"STOREFRONT_SERVICE",actorId:principal.apiKeyId,sellerAccountingName:line!.sellerAccountingName});
  expect(await f.db.select().from(auditLogs).where(eq(auditLogs.entityId,result.rows[0]!.id))).toMatchObject([{actorType:"STOREFRONT_SERVICE",actorId:principal.apiKeyId,actorUserId:null}]);
});

it("freezes snapshots in the database and rejects AUTO_ASSUMED in controlled mode and unauthorized manual proofs",async()=>{
  const f=await inventoryFixture();
  await f.apply([{...f.line,type:"RESERVE",quantity:1,paymentMethod:"CARD"}]);
  const [header]=await f.db.select().from(reservations).where(eq(reservations.id,f.line.reservationId));
  const [line]=await f.db.select().from(reservationLines).where(eq(reservationLines.reservationId,header!.id));
  await expect(f.db.update(reservations).set({fulfillmentMode:"SIMPLIFIED_FULFILLMENT"}).where(eq(reservations.id,header!.id))).rejects.toThrow(/frozen/);
  await expect(f.db.update(reservationLines).set({sellerAccountingName:"Changed"}).where(eq(reservationLines.id,line!.id))).rejects.toThrow(/frozen/);
  const base={id:createUuidV7(),reservationId:header!.id,reservationLineId:line!.id,fulfillmentRequestId:f.line.fulfillmentRequestId,
    skuId:f.sku.id,allocationId:f.line.allocationId,action:"PICK_TO_STAGING",quantity:1};
  await expect(f.db.insert(unitConfirmations).values({...base,method:"AUTO_ASSUMED",triggerApiKeyId:header!.createdByApiKeyId,triggerCallId:createUuidV7()})).rejects.toThrow(/not authorized/);
  const [warehouse]=await f.db.insert(users).values({id:createUuidV7(),fullName:"Fixture",role:"WAREHOUSE"}).returning();
  await expect(f.db.insert(unitConfirmations).values({...base,method:"MANUAL",actorUserId:warehouse!.id,reason:"Missing label"})).rejects.toThrow(/not authorized/);
  const revoked=await f.db.insert(storefrontApiKeys).values({id:createUuidV7(),storefrontId:header!.storefrontId,keyPrefix:"fixture",keyHash:createUuidV7(),name:"Revoked",active:false}).returning();
  await expect(applyWorkflowStockMovements(f.db,{type:"STOREFRONT_SERVICE",apiKeyId:revoked[0]!.id,storefrontId:header!.storefrontId},[{...f.line,type:"RESERVATION_RELEASE",quantity:1}])).rejects.toMatchObject({code:"FORBIDDEN"});
  expect(await f.db.select().from(stockLedger).where(and(eq(stockLedger.reservationId,header!.id),eq(stockLedger.movementType,"RESERVE")))).toHaveLength(1);
});

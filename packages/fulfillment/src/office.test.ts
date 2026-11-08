import { expect,it } from "vitest";
import { and,eq } from "drizzle-orm";
import { auditLogs, fulfillmentLines, stockLedger, users } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import { setFulfillmentMode } from "../../reservations/src/index.ts";
import { reservationFixture } from "../../reservations/src/reservation.test-fixture.ts";
import { confirmFulfillmentUnit, reserveOrder } from "./index.ts";
import { fulfillmentOfficeAction, getFulfillmentOfficeDetail, listFulfillmentOffice } from "./office.ts";
async function open(mode="CONTROLLED_FULFILLMENT") {
  const f=await reservationFixture(),p={type:"USER" as const,userId:f.actor.userId};await setFulfillmentMode(f.db,p,createUuidV7(),{mode});
  const order=await reserveOrder(f.db,f.principal,createUuidV7(),{storefrontOrderRef:"Office-1",paymentMethod:"PAY_ON_PICKUP",items:[{skuId:f.sku.id,quantity:2}],confirmation:{deliveryMethod:"PICKUP",shipBy:"2030-01-01",prices:[{skuId:f.sku.id,finalUnitPriceMinor:100,currency:"GEL"}]}});
  return {...f,p,id:order.body.fulfillmentRequestId!};
}
it("allows only office roles, shows provenance and expiry without revealing the setting to ORDER_MANAGER",async()=>{
  const f=await open("SIMPLIFIED_FULFILLMENT"),[manager,warehouse]=await f.db.insert(users).values(["ORDER_MANAGER","WAREHOUSE"].map((role)=>({id:createUuidV7(),role,fullName:"Office fixture"}))).returning();
  const detail=await getFulfillmentOfficeDetail(f.db,{type:"USER",userId:manager!.id},f.id);
  expect(detail).toMatchObject({canCancel:false,canMarkLost:false,expiresAt:null});expect(detail.history).toContainEqual(expect.objectContaining({confirmation:"AUTO_ASSUMED",actorType:"SYSTEM_WORKFLOW",triggerApiKeyId:f.principal.apiKeyId}));
  expect(detail.confirmations).toContainEqual(expect.objectContaining({method:"AUTO_ASSUMED"}));
  const view=await listFulfillmentOffice(f.db,{type:"USER",userId:manager!.id});expect(view).not.toHaveProperty("mode");expect(view.requests.find((r)=>r.id===f.id)?.confirmation).toBe("AUTO_ASSUMED");
  await expect(listFulfillmentOffice(f.db,{type:"USER",userId:warehouse!.id})).rejects.toThrow(/access/);
  expect((await listFulfillmentOffice(f.db,f.p)).mode).toBe("SIMPLIFIED_FULFILLMENT");
  await expect(setFulfillmentMode(f.db,{type:"USER",userId:manager!.id},createUuidV7(),{mode:"CONTROLLED_FULFILLMENT"})).rejects.toThrow(/ADMIN/);
  const ledger=await f.db.select().from(stockLedger).where(eq(stockLedger.fulfillmentRequestId,f.id));
  await expect(fulfillmentOfficeAction(f.db,f.p,createUuidV7(),{action:"CANCEL",fulfillmentRequestId:f.id,reason:"Closed"})).rejects.toThrow();
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.fulfillmentRequestId,f.id))).toEqual(ledger);
});
it("gates controlled actions on current and frozen mode, preserves staged units and audits loss",async()=>{
  const f=await open(),detail=await getFulfillmentOfficeDetail(f.db,f.p,f.id),line=detail.lines[0]!;
  expect(detail.canCancel).toBe(true);
  await confirmFulfillmentUnit(f.db,f.p,createUuidV7(),{fulfillmentRequestId:f.id,lineId:line.id,action:"PICK",confirmation:{method:"MANUAL",reason:"Unit label missing"}});
  expect((await getFulfillmentOfficeDetail(f.db,f.p,f.id)).confirmations).toContainEqual(expect.objectContaining({method:"MANUAL",reason:"Unit label missing"}));
  await setFulfillmentMode(f.db,f.p,createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
  expect((await getFulfillmentOfficeDetail(f.db,f.p,f.id)).canCancel).toBe(false);
  await expect(fulfillmentOfficeAction(f.db,f.p,createUuidV7(),{action:"CANCEL",fulfillmentRequestId:f.id,reason:"Hidden"})).rejects.toThrow(/unavailable/);
  await setFulfillmentMode(f.db,f.p,createUuidV7(),{mode:"CONTROLLED_FULFILLMENT"});
  const key=createUuidV7(),input={action:"CANCEL",fulfillmentRequestId:f.id,reason:"Cancelled before handover"};
  const cancelled=await fulfillmentOfficeAction(f.db,f.p,key,input);expect(cancelled.body.requiresReturnToShelf).toBe(true);
  expect((await fulfillmentOfficeAction(f.db,f.p,key,input)).body).toEqual(cancelled.body);
  expect((await listFulfillmentOffice(f.db,f.p,true)).requests).toContainEqual(expect.objectContaining({id:f.id,requiresReturnToShelf:true}));
  const [stored]=await f.db.select().from(fulfillmentLines).where(eq(fulfillmentLines.id,line.id));expect(stored!.returnedQuantity).toBe(0);
  await fulfillmentOfficeAction(f.db,f.p,createUuidV7(),{action:"LOST",fulfillmentRequestId:f.id,lineId:line.id,reason:"Unit cannot be found"});
  expect(await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityId,line.id),eq(auditLogs.action,"FULFILLMENT_UNIT_LOST")))).toHaveLength(1);
});

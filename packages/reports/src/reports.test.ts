import { expect,it } from "vitest";
import ExcelJS from "exceljs";
import { and,eq,sql } from "drizzle-orm";
import { accountingMappings,reservationItems,stockLedger,storefronts,userEntityMemberships,userPermissions,users,entityRelationships,allocations,storefrontApiKeys,storefrontListings } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import { reserveOrder,confirmOrder,cancelFulfillment,confirmFulfillmentUnit } from "../../fulfillment/src/index.ts";
import { configureAvailabilityPool } from "@khidi/inventory";
import { setFulfillmentMode } from "../../reservations/src/index.ts";
import { reservationFixture } from "../../reservations/src/reservation.test-fixture.ts";
import { assertBundleSingleOwner } from "../../reservations/src/bundle-owner.ts";
import { movementReport,exportReport,reportEntities,reportLines,decimalMinor,setReportAccess,type MovementRow } from "./index.ts";
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tbilisi",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const range=(id:string)=>({entityId:id,from:today(),to:today()});
it("reports immutable COMMIT accounting, final price and VAT; bundles carry one price and AUTO_ASSUMED provenance",async()=>{
 const f=await reservationFixture(),bundle=await f.bundle();
 await setFulfillmentMode(f.db,{type:"USER",userId:f.actor.userId},createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
 await reserveOrder(f.db,f.principal,createUuidV7(),{storefrontOrderRef:"private-order",paymentMethod:"PAY_ON_PICKUP",items:[{skuId:bundle.sku.id,quantity:2}],
  confirmation:{deliveryMethod:"PICKUP",shipBy:"2030-01-01",prices:[{skuId:bundle.sku.id,finalUnitPriceMinor:12345,currency:"GEL"}]}});
 await f.db.update(accountingMappings).set({accountingName:"NEW current mapping"}).where(eq(accountingMappings.skuId,f.sku.id));
 const report=await movementReport(f.db,f.actor.userId,range(f.entities[0]!.id));
 expect(report.seller.map(r=>r.rowKind)).toEqual(["BUNDLE","COMPONENT","COMPONENT"]);
 expect(report.seller[0]).toMatchObject({totalMinor:"24690",unitPrice:"12345",quantity:2,vat:true,provenance:"AUTO_ASSUMED"});
 expect(report.seller.slice(1).every(r=>r.unitPrice===null&&r.totalMinor===null&&r.accountingName==="M9 fixture")).toBe(true);
 expect(report.totals.map(r=>r.totalMinor)).toEqual(["24690","24690"]);
 expect(report.owner[0]).toMatchObject({totalMinor:"24690",provenance:"AUTO_ASSUMED"});
 const ledger=await f.db.select().from(stockLedger).where(and(eq(stockLedger.skuId,f.sku.id),eq(stockLedger.movementType,"HANDOVER_OUT")));
 expect(report.owner.find(r=>r.rowKind==="COMPONENT"&&r.sku===f.sku.internalSku)!.quantity).toBe(ledger.reduce((n,l)=>n+l.quantity,0));
 const csv=await exportReport(report,"CSV");expect([...csv.subarray(0,3)]).toEqual([239,187,191]);expect(csv.toString()).not.toContain("NEW current mapping");
 expect((await exportReport({...report,seller:[{...report.seller[0]!,orderRef:"=formula"}]},"CSV")).toString()).toContain("'=formula");
 const book=new ExcelJS.Workbook();await book.xlsx.load(new Uint8Array(await exportReport(report,"XLSX")) as never);
 expect(book.worksheets).toHaveLength(5);expect(book.worksheets[0]!.getCell("J2").value).toBe("123.45");
});
it("corrects a bundle once on its cancellation day, without duplicating later component quantities",async()=>{
 const f=await reservationFixture(),bundle=await f.bundle(),staff={type:"USER" as const,userId:f.actor.userId};
 await setFulfillmentMode(f.db,staff,createUuidV7(),{mode:"CONTROLLED_FULFILLMENT"});
 const order=await reserveOrder(f.db,f.principal,createUuidV7(),{storefrontOrderRef:"staged-bundle",paymentMethod:"CARD",items:[{skuId:bundle.sku.id,quantity:1}]});
 const confirmed=await confirmOrder(f.db,f.principal,createUuidV7(),{reservationId:order.body.reservationId,confirmation:{deliveryMethod:"COURIER",shipBy:"2030-01-01",prices:[{skuId:bundle.sku.id,finalUnitPriceMinor:15000,currency:"GEL"}]}});
 const {fulfillmentLines}=await import("@khidi/db");
 const lines=await f.db.select().from(fulfillmentLines).where(eq(fulfillmentLines.fulfillmentRequestId,confirmed.body.fulfillmentRequestId!));
 const line=lines.find(l=>l.skuId===f.sku.id)!;
 await confirmFulfillmentUnit(f.db,staff,createUuidV7(),{fulfillmentRequestId:confirmed.body.fulfillmentRequestId,lineId:line.id,action:"PICK",confirmation:{method:"SCAN",identifier:f.sku.internalSku}});
 await cancelFulfillment(f.db,staff,createUuidV7(),{fulfillmentRequestId:confirmed.body.fulfillmentRequestId,reason:"Cancel bundle"});
 const cancelled=await movementReport(f.db,f.actor.userId,range(f.entities[0]!.id)),corrections=cancelled.seller.filter(r=>r.kind==="BUNDLE_CANCELLED");
 expect(corrections.filter(r=>r.rowKind==="BUNDLE")).toMatchObject([{totalMinor:"-15000",quantity:-1}]);
 expect(corrections).toHaveLength(1);expect(corrections[0]!.componentSnapshots).toHaveLength(2);
 expect(cancelled.seller.filter(r=>r.kind==="COMMIT_RELEASE").every(r=>r.rowKind==="COMPONENT"&&r.totalMinor===null&&r.unitPrice===null)).toBe(true);
 expect(cancelled.totals.find(t=>t.view==="seller")!.totalMinor).toBe("0");
 const previousMovements=await f.db.select({id:stockLedger.id}).from(stockLedger).where(eq(stockLedger.reservationId,order.body.reservationId!));
 await confirmFulfillmentUnit(f.db,staff,createUuidV7(),{fulfillmentRequestId:confirmed.body.fulfillmentRequestId,lineId:line.id,action:"RETURN",confirmation:{method:"SCAN",identifier:f.sku.internalSku}});
 const complete=await movementReport(f.db,f.actor.userId,range(f.entities[0]!.id));
 expect(complete.seller.filter(r=>r.kind==="BUNDLE_CANCELLED"&&r.rowKind==="BUNDLE")).toHaveLength(1);
 expect(complete.totals.find(t=>t.view==="seller")!.totalMinor).toBe("0");
 expect(complete.seller.filter(r=>r.kind==="COMMIT_RELEASE").reduce((n,r)=>n+r.quantity,0)).toBe(-5);
 const all=await f.db.select().from(stockLedger).where(eq(stockLedger.reservationId,order.body.reservationId!));
 const returned=all.find(l=>l.movementType==="COMMIT_RELEASE"&&!previousMovements.some(p=>p.id===l.id))!;
 // Session-local timestamp fixtures model a next-day return without changing immutable
 // real ledger/history rows, disabling triggers, or adding a production clock override.
 await f.db.transaction(async tx=>{
  await tx.execute(sql`CREATE TEMP TABLE stock_ledger (LIKE public.stock_ledger INCLUDING DEFAULTS) ON COMMIT DROP`);
  await tx.execute(sql`INSERT INTO pg_temp.stock_ledger SELECT * FROM public.stock_ledger WHERE reservation_id=${order.body.reservationId}::uuid`);
  await tx.execute(sql`UPDATE pg_temp.stock_ledger SET created_at=CASE WHEN id=${returned.id}::uuid THEN '2026-07-08 10:00Z'::timestamptz ELSE '2026-07-07 10:00Z'::timestamptz END`);
  await tx.execute(sql`CREATE TEMP TABLE fulfillment_history (LIKE public.fulfillment_history INCLUDING DEFAULTS) ON COMMIT DROP`);
  await tx.execute(sql`INSERT INTO pg_temp.fulfillment_history SELECT * FROM public.fulfillment_history WHERE fulfillment_request_id=${confirmed.body.fulfillmentRequestId}::uuid`);
  await tx.execute(sql`UPDATE pg_temp.fulfillment_history SET created_at=CASE WHEN action='FULFILLMENT_UNIT_RETURNED' THEN '2026-07-08 10:00Z'::timestamptz ELSE '2026-07-07 10:00Z'::timestamptz END`);
  const period={entityId:f.entities[0]!.id,from:"2026-07-07",to:"2026-07-07"};
  const decision=await movementReport(tx,f.actor.userId,period),next=await movementReport(tx,f.actor.userId,{...period,from:"2026-07-08",to:"2026-07-08"});
  expect(decision.seller.filter(r=>r.kind==="BUNDLE_CANCELLED"&&r.rowKind==="BUNDLE")).toHaveLength(1);
  expect(decision.totals.find(t=>t.view==="seller")!.totalMinor).toBe("0");
  expect(next.seller).toMatchObject([{kind:"COMMIT_RELEASE",quantity:-1,totalMinor:null,unitPrice:null}]);
  expect(next.totals).toHaveLength(0);
  const whole=await movementReport(tx,f.actor.userId,{...period,to:"2026-07-08"});
  expect(whole.totals.find(t=>t.view==="seller")!.totalMinor).toBe("0");
  expect(whole.seller.filter(r=>r.rowKind==="COMPONENT").reduce((n,r)=>n+r.quantity,0)).toBe(0);
 });
});
it("keeps sale and physical exit distinct, and pre-handover cancellation is a separate negative correction",async()=>{
 const f=await reservationFixture();await setFulfillmentMode(f.db,{type:"USER",userId:f.actor.userId},createUuidV7(),{mode:"CONTROLLED_FULFILLMENT"});
 const order=await reserveOrder(f.db,f.principal,createUuidV7(),{storefrontOrderRef:"release",paymentMethod:"CARD",items:[{skuId:f.sku.id,quantity:2}]});
 const confirmed=await confirmOrder(f.db,f.principal,createUuidV7(),{reservationId:order.body.reservationId,confirmation:{deliveryMethod:"COURIER",shipBy:"2030-01-01",prices:[{skuId:f.sku.id,finalUnitPriceMinor:15000,currency:"GEL"}]}});
 const before=await movementReport(f.db,f.actor.userId,range(f.entities[0]!.id));
 expect(before.seller[0]).toMatchObject({kind:"COMMIT",totalMinor:"30000",exitDate:null});expect(before.owner).toHaveLength(0);
 await cancelFulfillment(f.db,{type:"USER",userId:f.actor.userId},createUuidV7(),{fulfillmentRequestId:confirmed.body.fulfillmentRequestId,reason:"Cancelled before dispatch"});
 const after=await movementReport(f.db,f.actor.userId,range(f.entities[0]!.id));
 expect(after.seller.find(r=>r.kind==="COMMIT_RELEASE")).toMatchObject({quantity:-2,totalMinor:"-30000",accountingName:"M9 fixture"});
 expect(after.totals[0]!.totalMinor).toBe("0");expect(after.owner).toHaveLength(0);
 const [item]=await f.db.select().from(reservationItems).where(eq(reservationItems.reservationId,order.body.reservationId!));
 await expect(f.db.update(reservationItems).set({vatIncluded:false}).where(eq(reservationItems.id,item!.id))).rejects.toThrow();
});
it("limits reports.view to own memberships, never warehouse, and audits administrative grants",async()=>{
 const f=await reservationFixture(),[accountant,warehouse]=await f.db.insert(users).values(["OPERATOR","WAREHOUSE"].map(role=>({id:createUuidV7(),role,fullName:"Report access fixture"}))).returning();
 await f.db.insert(userEntityMemberships).values([{userId:accountant!.id,legalEntityId:f.entities[0]!.id},{userId:warehouse!.id,legalEntityId:f.entities[0]!.id}]);
 await expect(reportEntities(f.db,accountant!.id)).rejects.toMatchObject({code:"FORBIDDEN"});
 await setReportAccess(f.db,f.actor.userId,createUuidV7(),{userId:accountant!.id,entityId:f.entities[0]!.id,granted:true,recipient:true});
 expect((await reportEntities(f.db,accountant!.id)).map(e=>e.id)).toEqual([f.entities[0]!.id]);
 await expect(movementReport(f.db,accountant!.id,range(f.entities[1]!.id))).rejects.toMatchObject({code:"FORBIDDEN"});
 await f.db.insert(userPermissions).values({userId:warehouse!.id,permissionKey:"reports.view",grantedBy:f.actor.userId});
 await expect(reportEntities(f.db,warehouse!.id)).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("refuses mixed-owner bundle plans; defensive reporting excludes their header from owner money",()=>{
 const components=[{ownerMapping:{legalEntityId:"a"}},{ownerMapping:{legalEntityId:"b"}}];
 expect(()=>assertBundleSingleOwner(true,components)).toThrow(/one stock owner/);expect(()=>assertBundleSingleOwner(true,[components[0]!,components[0]!])).not.toThrow();
 const base={id:"a",kind:"HANDOVER_OUT",date:today(),quantity:2,itemQuantity:2,lineQuantity:2,itemId:"i",itemSku:"bundle",bundle:true,unitPrice:"100",currency:"GEL",correlation:"c"} as MovementRow;
 expect(reportLines([{...base,ownerId:"a"},{...base,id:"b",ownerId:"b"}],true)[0]).toMatchObject({allocationUndetermined:true,unitPrice:"100",totalMinor:null});
 expect(decimalMinor("900719925474099101")).toBe("9007199254740991.01");
});
it("availability declarations stay outside sales and both transfer sides retain their documents",async()=>{
 const f=await reservationFixture();
 await f.db.insert(entityRelationships).values({id:createUuidV7(),fromEntityId:f.entities[0]!.id,toEntityId:f.entities[1]!.id,mode:"PURCHASE",effectiveFrom:new Date(0)});
 await f.apply([{...f.base,type:"TRANSFER_OUT",variant:"CROSS_POOL",quantity:2,transferKey:"move",documentRef:"DOC-17"},
  {poolId:f.pools[1]!.id,skuId:f.sku.id,type:"TRANSFER_IN",variant:"CROSS_POOL",quantity:2,transferKey:"move",documentRef:"DOC-17"}]);
 await f.apply([{...f.base,type:"STOCK_IN",quantity:3,reason:"availability set"}]);
 for(const entity of f.entities){
  const report=await movementReport(f.db,f.actor.userId,{...range(entity.id),availability:true});
  expect(report.transfers.some(r=>r.document==="DOC-17")).toBe(true);expect(report.seller).toHaveLength(0);
  expect(report.availability).toHaveLength(entity.id===f.entities[0]!.id?1:0);
 }
});
it("reports CONSIGNMENT seller and stock owner separately using their own accounting snapshots",async()=>{
 const f=await reservationFixture(),store=f.stores[2]!;
 await f.db.insert(entityRelationships).values({id:createUuidV7(),fromEntityId:f.entities[0]!.id,toEntityId:f.entities[1]!.id,mode:"CONSIGNMENT",effectiveFrom:new Date(0)});
 await configureAvailabilityPool(f.db,f.actor,{storefrontId:store.id,poolId:f.pool.id});
 const [allocation]=await f.db.insert(allocations).values({id:createUuidV7(),poolId:f.pool.id,storefrontId:store.id,skuId:f.sku.id}).returning();
 await f.apply([{...f.base,type:"ALLOCATE",allocationId:allocation!.id,quantity:3}]);
 await f.db.insert(accountingMappings).values({id:createUuidV7(),skuId:f.sku.id,legalEntityId:f.entities[1]!.id,accountingItemId:"SELL-2",accountingName:"Seller two"});
 await f.db.insert(storefrontListings).values({id:createUuidV7(),storefrontId:store.id,skuId:f.sku.id,enabled:true});
 const {setPrice}=await import("../../pricing/src/index.ts");await setPrice(f.db,f.actor,{storefrontId:store.id,skuId:f.sku.id,basePriceMinor:10000});
 const [key]=await f.db.insert(storefrontApiKeys).values({id:createUuidV7(),storefrontId:store.id,name:"Reports",keyPrefix:"test",keyHash:createUuidV7()}).returning();
 await setFulfillmentMode(f.db,{type:"USER",userId:f.actor.userId},createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
 await reserveOrder(f.db,{type:"STOREFRONT_SERVICE",storefrontId:store.id,apiKeyId:key!.id},createUuidV7(),{storefrontOrderRef:"consignment",paymentMethod:"PAY_ON_PICKUP",items:[{skuId:f.sku.id,quantity:1}],
  confirmation:{deliveryMethod:"PICKUP",shipBy:"2030-01-01",prices:[{skuId:f.sku.id,finalUnitPriceMinor:11100,currency:"GEL"}]}});
 const seller=await movementReport(f.db,f.actor.userId,range(f.entities[1]!.id)),owner=await movementReport(f.db,f.actor.userId,range(f.entities[0]!.id));
 expect(seller.seller[0]).toMatchObject({accountingId:"SELL-2",totalMinor:"11100",relationship:"CONSIGNMENT"});expect(seller.owner).toHaveLength(0);
 expect(owner.seller).toHaveLength(0);expect(owner.owner[0]).toMatchObject({accountingName:"M9 fixture",totalMinor:"11100",relationship:"CONSIGNMENT"});
 expect(JSON.stringify(seller)).not.toMatch(/ownerAccounting|M9 fixture/);
 expect(JSON.stringify(owner)).not.toMatch(/sellerAccounting|SELL-2|Seller two/);
});

import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { accountingMappings, allocationBalances, idempotencyKeys, bundleComponents, reservationLines, reservations, skus, stockLedger, storefrontApiKeys, storefronts } from "@khidi/db";
import { getSkuReserveEligibility, getReservationStockFacts } from "@khidi/publishing";
import { createSkuDraft, setPrimaryAccountingMapping } from "../../products/src/index.ts";
import { createUuidV7 } from "@khidi/shared";
import { parseInput, reserveSchema, orderReferenceSchema, type ReserveInput } from "./contracts.ts";
import { reserveInTransaction, commitInTransaction, lockReservation, workflowCommand } from "./internal.ts";
import { reservationFixture } from "./reservation.test-fixture.ts";
import { extendReservation } from "./index.ts";

async function reserve(f:Awaited<ReturnType<typeof reservationFixture>>,items=[{skuId:f.sku.id,quantity:2}],key=createUuidV7()) {
  const input=parseInput(reserveSchema,{storefrontOrderRef:"A-123456789",paymentMethod:"CARD",items});
  return workflowCommand(f.db,f.principal,"reserve-test",key,input,async(ctx)=>{
    const {header}=await reserveInTransaction(ctx,f.principal,input,key);return {status:201,body:{reservationId:header.id,expiresAt:header.expiresAt.toISOString()}};
  });
}
it("rejects personal-data fields and opaque references that look like email or telephone numbers",()=>{
  for(const ref of ["a@b.test","555123456","+995555123456","A 5",""]) expect(orderReferenceSchema.safeParse(ref).success).toBe(false);
  for(const ref of ["A-123456789","12345678","order_1.x"]) expect(orderReferenceSchema.safeParse(ref).success).toBe(true);
  const input={storefrontOrderRef:"A-1",paymentMethod:"CARD",items:[{skuId:createUuidV7(),quantity:1}]};
  for(const field of ["name","phone","email","address","customer"]) expect(reserveSchema.safeParse({...input,[field]:"private"}).success).toBe(false);
  expect(reserveSchema.safeParse({...input,items:[{...input.items[0],phone:"private"}]}).success).toBe(false);
});
it("reserves only the availability-pool allocation, freezes accounting at RESERVE, and durably replays",async()=>{
  const f=await reservationFixture(),key=createUuidV7(),first=await reserve(f,undefined,key);
  expect((await reserve(f,undefined,key)).body).toEqual(first.body);
  await f.db.update(idempotencyKeys).set({expiresAt:new Date(0)}).where(eq(idempotencyKeys.idempotencyKey,key));
  expect((await reserve(f,undefined,key)).body).toEqual(first.body);
  const [line]=await f.db.select().from(reservationLines).where(eq(reservationLines.reservationId,first.body.reservationId));
  expect(line).toMatchObject({allocationId:f.as[0]!.id,sellerAccountingName:"M9 fixture",quantity:2});
  const [other]=await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[1]!.id));
  expect(other).toMatchObject({reserved:0});
  await f.db.update(accountingMappings).set({active:false,accountingName:"Changed"}).where(eq(accountingMappings.id,line!.sellerMappingId));
  await f.db.update(storefronts).set({active:false}).where(eq(storefronts.id,f.store.id));
  await workflowCommand(f.db,f.principal,"commit-test",createUuidV7(),{id:first.body.reservationId},async(ctx)=>{
    const state=await lockReservation(ctx.tx,f.principal,first.body.reservationId);await commitInTransaction(ctx,f.principal,state);return {status:200,body:{status:state.header.status}};
  });
  const rows=await f.db.select().from(stockLedger).where(and(eq(stockLedger.reservationId,first.body.reservationId),eq(stockLedger.movementType,"COMMIT")));
  expect(rows).toMatchObject([{sellerAccountingName:"M9 fixture",ownerAccountingName:"M9 fixture",actorType:"STOREFRONT_SERVICE",actorId:f.principal.apiKeyId}]);
  expect(JSON.stringify(first.body)).not.toMatch(/KH-|accounting|mapping|fulfillmentMode|khidi\.app/i);
});
it("expands only composed bundles, needs no component listing or price, and commits the immutable component snapshot",async()=>{
  const f=await reservationFixture(),bundle=await f.bundle();
  const target={skuId:bundle.sku.id,storefrontId:f.store.id,locale:"ka"};
  expect(await getSkuReserveEligibility(f.db,target)).toMatchObject({sellable:true,stock:{availableToSell:6}});
  const result=await reserve(f,[{skuId:bundle.sku.id,quantity:2}]);
  const lines=await f.db.select().from(reservationLines).where(eq(reservationLines.reservationId,result.body.reservationId));
  expect(lines.map((l)=>[l.skuId,l.quantity]).sort()).toEqual([[f.sku.id,4],[bundle.second.sku.id,6]].sort());
  expect(lines.every((l)=>l.parentBundleSkuId===bundle.sku.id)).toBe(true);
  await f.db.update(bundleComponents).set({quantity:10}).where(eq(bundleComponents.bundleSkuId,bundle.sku.id));
  await workflowCommand(f.db,f.principal,"commit-test",createUuidV7(),{},async(ctx)=>{
    const state=await lockReservation(ctx.tx,f.principal,result.body.reservationId);await commitInTransaction(ctx,f.principal,state);return {status:200,body:{ok:true}};
  });
  expect((await f.db.select().from(stockLedger).where(and(eq(stockLedger.reservationId,result.body.reservationId),eq(stockLedger.movementType,"COMMIT")))).map((l)=>l.quantity).sort()).toEqual([4,6]);
  await f.db.update(accountingMappings).set({active:false}).where(eq(accountingMappings.skuId,bundle.second.sku.id));
  expect((await getSkuReserveEligibility(f.db,target)).sellable).toBe(false);
  const before=await f.db.select().from(reservations);
  await expect(reserve(f,[{skuId:bundle.sku.id,quantity:1}])).rejects.toThrow();
  expect(await f.db.select().from(reservations)).toEqual(before);
  const kit=await f.extraSku(true);
  await f.db.update(skus).set({isKit:true}).where(eq(skus.id,kit.sku.id));
  expect((await getReservationStockFacts(f.db,kit.sku.id,f.store.id)).components.map((c)=>c.skuId)).toEqual([kit.sku.id]);
});
it("blocks ambiguous mappings until a single active primary is selected and blocks missing bundle allocation",async()=>{
  const f=await reservationFixture(),bundle=await f.bundle();
  const [mapping]=await f.db.insert(accountingMappings).values({id:createUuidV7(),skuId:f.sku.id,legalEntityId:f.store.sellerEntityId,accountingItemId:createUuidV7(),accountingName:"Second",active:true}).returning();
  expect((await getSkuReserveEligibility(f.db,{skuId:f.sku.id,storefrontId:f.store.id,locale:"ka"})).sellable).toBe(false);
  await setPrimaryAccountingMapping(f.db,f.actor,createUuidV7(),{mappingId:mapping!.id});
  expect((await getSkuReserveEligibility(f.db,{skuId:f.sku.id,storefrontId:f.store.id,locale:"ka"})).sellable).toBe(true);
  await expect(f.db.update(accountingMappings).set({isPrimary:true}).where(and(eq(accountingMappings.skuId,f.sku.id),eq(accountingMappings.isPrimary,false)))).rejects.toThrow();
  const missing=await createSkuDraft(f.db,f.actor,{}); await f.ready(missing.id,false);
  await f.db.insert(bundleComponents).values({bundleSkuId:bundle.sku.id,componentSkuId:missing.id,quantity:1});
  expect((await getReservationStockFacts(f.db,bundle.sku.id,f.store.id)).blockingReasons).toContain("MISSING_STOREFRONT_ALLOCATION");
  const wrongStore=f.stores[1]!;
  expect((await getReservationStockFacts(f.db,bundle.sku.id,wrongStore.id)).blockingReasons).toContain("MISSING_STOREFRONT_ALLOCATION");
});
it("honors configured reservation deadlines and requires an explicit extension",async()=>{
  const f=await reservationFixture();
  await f.db.update(storefronts).set({reservationPolicyJson:{CARD:120,BANK_INSTALLMENT:600,CASH_ON_DELIVERY:600,PAY_ON_PICKUP:600}}).where(eq(storefronts.id,f.store.id));
  const before=Date.now(),r=await reserve(f);
  expect(Date.parse(r.body.expiresAt)-before).toBeGreaterThanOrEqual(119000);
  const expiresAt=new Date(Date.parse(r.body.expiresAt)+60000).toISOString();
  expect((await extendReservation(f.db,f.principal,createUuidV7(),{reservationId:r.body.reservationId,expiresAt})).body.expiresAt).toBe(expiresAt);
});

it("rolls back every cart line when bundle and ordinary items compete for the same component",async()=>{
  const f=await reservationFixture(),bundle=await f.bundle();
  const before=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
  await expect(reserve(f,[{skuId:bundle.sku.id,quantity:6},{skuId:f.sku.id,quantity:50}])).rejects.toThrow(/available/);
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id))).toEqual(before);
  expect((await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[0]!.id)))[0]).toMatchObject({reserved:0,committed:0});
});

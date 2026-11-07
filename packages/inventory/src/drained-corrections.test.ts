import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { allocationBalances, getSkuLineageIds, skus, stockLedger } from "@khidi/db";
import { createSkuDraft, mergeSkus, transitionSkuLifecycle } from "@khidi/products";
import { makeSamenessFixture } from "../../products/src/sameness.test-fixture.ts";
import { createUuidV7 } from "@khidi/shared";
import { configureAvailabilityPool } from "./advanced.ts";
import { setOnlineAvailability } from "./availability.ts";
import { inventoryFixture } from "./test-fixture.ts";

it("refuses source balances and held units, then merges history-only into a stocked survivor without moving stock",async()=>{
  const f=await inventoryFixture(false),target=await createSkuDraft(f.db,f.actor,{});
  const same=await makeSamenessFixture(f.db,f.actor,f.sku.id,target.id);
  await configureAvailabilityPool(f.db,f.actor,{storefrontId:f.stores[0]!.id,poolId:f.base.poolId});
  const set=(skuId:string,target:number)=>setOnlineAvailability(f.db,f.actor,{skuId,storefrontId:f.stores[0]!.id,target,idempotencyKey:createUuidV7()});
  const input={sourceSkuId:f.sku.id,targetSkuId:target.id,samenessEvidenceId:same.id,identityConfirmed:true,reason:"Confirmed sameness"};
  await set(f.sku.id,5);const survivor=await set(target.id,9);
  const before=await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,survivor.body.allocationId));
  await expect(mergeSkus(f.db,f.actor,input)).rejects.toMatchObject({details:{blockedReason:"SKU_INVENTORY_NOT_DRAINED"}});
  await expect(transitionSkuLifecycle(f.db,f.actor,f.sku.id,"ARCHIVED")).rejects.toMatchObject({details:{blockedReason:"SKU_INVENTORY_NOT_DRAINED"}});
  await expect(f.db.update(skus).set({lifecycleState:"ARCHIVED"}).where(eq(skus.id,f.sku.id))).rejects.toThrow(/SKU_INVENTORY_NOT_DRAINED/);
  await f.apply([{...f.line,type:"RESERVE",quantity:5,paymentMethod:"CARD"},{...f.line,type:"COMMIT",quantity:2}]);
  await set(f.sku.id,0);
  await expect(mergeSkus(f.db,f.actor,input)).rejects.toMatchObject({details:{blockedReason:"SKU_INVENTORY_NOT_DRAINED"}});
  await f.apply([{...f.line,type:"RESERVATION_RELEASE",quantity:3},{...f.line,type:"COMMIT_RELEASE",quantity:2}]);
  await set(f.sku.id,0);
  const history=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
  expect(history.length).toBeGreaterThan(0);
  await mergeSkus(f.db,f.actor,input);
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id))).toEqual(history);
  expect(await getSkuLineageIds(f.db,target.id)).toContain(f.sku.id);
  expect(await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,survivor.body.allocationId))).toEqual(before);
});
it("archive permits drained history but refuses an open fulfillment when its future tables exist",async()=>{
  const f=await inventoryFixture(false);
  await f.apply([{...f.base,type:"STOCK_IN",quantity:1},{...f.base,type:"STOCK_OUT",quantity:1,reason:"Drain fixture"}]);
  await expect(f.db.transaction(async(tx)=>{
    await tx.execute(sql`CREATE TEMP TABLE fulfillment_requests(id uuid,status text) ON COMMIT DROP`);
    await tx.execute(sql`CREATE TEMP TABLE fulfillment_request_lines(fulfillment_request_id uuid,sku_id uuid,parent_bundle_sku_id uuid) ON COMMIT DROP`);
    const id=createUuidV7();
    await tx.execute(sql`INSERT INTO fulfillment_requests VALUES(${id}::uuid,'REQUESTED')`);
    await tx.execute(sql`INSERT INTO fulfillment_request_lines VALUES(${id}::uuid,${f.sku.id}::uuid,NULL)`);
    await transitionSkuLifecycle(tx,f.actor,f.sku.id,"ARCHIVED");
  })).rejects.toMatchObject({details:{blockedReason:"SKU_INVENTORY_NOT_DRAINED"}});
  await transitionSkuLifecycle(f.db,f.actor,f.sku.id,"ARCHIVED");
  expect((await f.db.select().from(skus).where(eq(skus.id,f.sku.id)))[0]!.lifecycleState).toBe("ARCHIVED");
});

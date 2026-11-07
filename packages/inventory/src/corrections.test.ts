import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { allocations, poolSkuBalances, skus, stockLedger } from "@khidi/db";
import { createSkuDraft, getProductTypeByKey, transitionSkuLifecycle } from "@khidi/products";
import { splitSku } from "@khidi/products/corrections";
import { inventoryFixture } from "./test-fixture.ts";
import { createUuidV7 } from "@khidi/shared";

it("ADR-011 refuses real allocation records, zero pool rows and zero-balance ledger history",async()=>{
  const f=await inventoryFixture(false),type=await getProductTypeByKey(f.db,"MOTOBLOCK");
  await f.db.update(skus).set({productTypeId:type!.id}).where(eq(skus.id,f.sku.id));
  const input={sourceSkuId:f.sku.id,reason:"Split fixture",targets:[{claims:{wheel_type:"RUBBER"}},{claims:{wheel_type:"IRON"}}]};
  await expect(splitSku(f.db,f.actor,input)).rejects.toThrow(/ADR-011 Part B/); // Allocation, without ledger.
  const zero=await createSkuDraft(f.db,f.actor,{productTypeId:type!.id});
  await f.db.insert(poolSkuBalances).values({poolId:f.base.poolId,skuId:zero.id});
  await expect(splitSku(f.db,f.actor,{...input,sourceSkuId:zero.id})).rejects.toThrow(/ADR-011 Part B/);
  const drained=await createSkuDraft(f.db,f.actor,{productTypeId:type!.id});
  await f.apply([{...f.base,skuId:drained.id,type:"STOCK_IN",quantity:1},{...f.base,skuId:drained.id,type:"STOCK_OUT",quantity:1,reason:"Returned"}]);
  expect(await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,drained.id))).toHaveLength(2);
  await expect(splitSku(f.db,f.actor,{...input,sourceSkuId:drained.id})).rejects.toThrow(/ADR-011 Part B/);
});

it("rejects stock writes and new allocations after a source is archived",async()=>{
  const f=await inventoryFixture(false);
  await transitionSkuLifecycle(f.db,f.actor,f.sku.id,"ARCHIVED",{reason:"Archived fixture"});
  await expect(f.apply([{...f.base,type:"STOCK_IN",quantity:1}])).rejects.toThrow(/Archived/);
  await expect(f.db.insert(allocations).values({id:createUuidV7(),...f.base,storefrontId:f.stores[2]!.id})).rejects.toThrow(/Archived/);
});

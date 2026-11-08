import { eq } from "drizzle-orm";
import { accountingMappings, allocations, bundleComponents, productImages, skus, skuContentVersions, skuContentApprovals, storefrontListings, storefrontApiKeys, storefronts } from "@khidi/db";
import { createSkuDraft } from "../../products/src/index.ts";
import { configureAvailabilityPool } from "@khidi/inventory";
import { setPrice } from "../../pricing/src/index.ts";
import { createUuidV7 } from "@khidi/shared";
import { inventoryFixture } from "../../inventory/src/test-fixture.ts";

export async function reservationFixture() {
  const f=await inventoryFixture(false);
  const store=f.stores[0]!,pool=f.pools[0]!;
  await configureAvailabilityPool(f.db,f.actor,{storefrontId:store.id,poolId:pool.id});
  const [key]=await f.db.insert(storefrontApiKeys).values({id:createUuidV7(),storefrontId:store.id,name:"M9 test",keyPrefix:"m9",keyHash:createUuidV7()}).returning();
  const principal={type:"STOREFRONT_SERVICE" as const,apiKeyId:key!.id,storefrontId:store.id};
  async function ready(skuId:string,publicProduct=true) {
    // A documented legacy LOW fixture; all production READY transitions remain evidence-controlled.
    await f.db.update(skus).set({lifecycleState:"READY",canonicalSlug:"fixture-"+skuId.replaceAll("-","").split("").map((c)=>String.fromCharCode(103+parseInt(c,16))).join(""),reverificationRequired:true}).where(eq(skus.id,skuId));
    await f.db.insert(accountingMappings).values({id:createUuidV7(),skuId,legalEntityId:store.sellerEntityId,accountingItemId:createUuidV7(),accountingName:"M9 fixture",active:true});
    if(publicProduct) {
      const [content]=await f.db.insert(skuContentVersions).values({id:createUuidV7(),skuId,locale:"ka",origin:"MANUAL",authorId:f.actor.userId,
        displayName:"ნივთი",shortDescription:"ნივთი",fullDescription:"ნივთი",verifiedFacts:{}}).returning();
      await f.db.insert(skuContentApprovals).values({skuId,locale:"ka",versionId:content!.id,approvedBy:f.actor.userId});
      await f.db.insert(storefrontListings).values({id:createUuidV7(),skuId,storefrontId:store.id,enabled:true});
      const id=createUuidV7();
      await f.db.insert(productImages).values({id,skuId,slot:"MAIN",role:"MAIN",usage:"PUBLIC",status:"VERIFIED",rawStorageKey:"raw/"+id+"/original.jpg",
        rawSha256:"a".repeat(64),rawBytes:100,mimeType:"image/jpeg",width:1920,height:1080,capturedAt:new Date(),deviceId:createUuidV7(),idempotencyKey:id,
        requestHash:"b".repeat(64),tier1QualityJson:{passed:true},createdBy:f.actor.userId,verifiedBy:f.actor.userId,verifiedAt:new Date(),processingStatus:"COMPLETED",masterVersion:1,masterStorageKey:"master/"+id+"/1.jpg",masterSha256:"c".repeat(64)});
      await setPrice(f.db,f.actor,{skuId,storefrontId:store.id,basePriceMinor:10000});
    }
  }
  await ready(f.sku.id);
  await f.apply([{...f.base,type:"STOCK_IN",quantity:100},{...f.base,allocationId:f.as[0]!.id,type:"ALLOCATE",quantity:60}]);
  async function extraSku(publicProduct=false,quantity=20) {
    const sku=await createSkuDraft(f.db,f.actor,{});await ready(sku.id,publicProduct);
    const [allocation]=await f.db.insert(allocations).values({id:createUuidV7(),poolId:pool.id,storefrontId:store.id,skuId:sku.id}).returning();
    await f.apply([{poolId:pool.id,skuId:sku.id,type:"STOCK_IN",quantity},{poolId:pool.id,skuId:sku.id,allocationId:allocation!.id,type:"ALLOCATE",quantity}]);
    return {sku,allocation:allocation!};
  }
  async function bundle() {
    const second=await extraSku(),sku=await createSkuDraft(f.db,f.actor,{});await ready(sku.id);
    await f.db.update(skus).set({isComposedBundle:true}).where(eq(skus.id,sku.id));
    await f.db.update(accountingMappings).set({active:false}).where(eq(accountingMappings.skuId,sku.id));
    await f.db.insert(bundleComponents).values([{bundleSkuId:sku.id,componentSkuId:f.sku.id,quantity:2},{bundleSkuId:sku.id,componentSkuId:second.sku.id,quantity:3}]);
    return {sku,second};
  }
  return {...f,store,pool,principal,ready,extraSku,bundle};
}

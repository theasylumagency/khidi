import { expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, productImages, skus, type DbExecutor } from "@khidi/db";
import { createSkuDraft, getProductTypeByKey, mergeSkus, upsertProductType } from "@khidi/products";
import { splitSku } from "@khidi/products/corrections";
import { acquireDomainLocks, priceLockKey } from "@khidi/domain/locking";
import { createUuidV7 } from "@khidi/shared";
import { makeSamenessFixture } from "../../products/src/sameness.test-fixture.ts";
import { getCurrentPrice, setPrice } from "./index.ts";

const db=getDb();
async function fixture() {
  const admin=(await db.query.users.findFirst({where:(t,{eq})=>eq(t.role,"ADMIN")}))!;
  const store=(await db.query.storefronts.findFirst())!,actor={userId:admin.id};
  const target=await createSkuDraft(db,actor,{}),source=await createSkuDraft(db,actor,{});
  await setPrice(db,actor,{skuId:source.id,storefrontId:store.id,basePriceMinor:10000});
  return {actor,store,source,target};
}
async function waitForAdvisory(tag:string) {
  for(let i=0;i<200;i++) {
    const rows=await db.execute<{wait_event:string|null}>(sql`SELECT wait_event FROM pg_stat_activity WHERE application_name=${tag}`);
    if(rows.rows.some((row)=>row.wait_event === "advisory")) return;
    await new Promise((resolve)=>setTimeout(resolve,10));
  }
  throw new Error("Correction did not wait on the price advisory lock.");
}
async function overlap(sourceId:string,edit:(tx:DbExecutor)=>Promise<unknown>,correct:(tx:DbExecutor)=>Promise<unknown>) {
  const tag="m8-lock-"+createUuidV7();
  let correction:Promise<unknown>|undefined;
  await db.transaction(async(tx)=>{
    await tx.execute(sql`SET LOCAL statement_timeout='6s'`);
    await acquireDomainLocks(tx,{advisoryKeys:[priceLockKey(sourceId)]});
    correction=db.transaction(async(other)=>{
      await other.execute(sql`SELECT set_config('application_name',${tag},true)`);
      await other.execute(sql`SET LOCAL statement_timeout='6s'`);
      return correct(other);
    });
    // Attach a handler before awaiting the competing transaction to avoid an unhandled rejection.
    void correction.catch(()=>{});
    await waitForAdvisory(tag);
    // With the old SKU→price order the correction holds the SKU here and creates a cycle.
    await edit(tx);
  });
  await correction;
}

it("a merge waits for the price advisory before touching SKU rows and withdraws the completed price",async()=>{
  const f=await fixture(),same=await makeSamenessFixture(db,f.actor,f.source.id,f.target.id);
  await overlap(f.source.id,(tx)=>setPrice(tx,f.actor,{skuId:f.source.id,storefrontId:f.store.id,basePriceMinor:11000}),
    (tx)=>mergeSkus(tx,f.actor,{sourceSkuId:f.source.id,targetSkuId:f.target.id,samenessEvidenceId:same.id,identityConfirmed:true,reason:"Same variant"}));
  expect(await getCurrentPrice(db,f.source.id,f.store.id)).toBeNull();
  expect((await db.select().from(skus).where(eq(skus.id,f.source.id)))[0]).toMatchObject({lifecycleState:"ARCHIVED"});
});

it("a split with an older target and a price commit completes without a lock cycle",async()=>{
  const f=await fixture(),template=await getProductTypeByKey(db,"MOTOBLOCK");
  const type=await upsertProductType(db,f.actor,{...template,key:"LOCK_SPLIT_"+createUuidV7().slice(-9),distinguishingAttributes:["wheel_type"]});
  await db.update(skus).set({productTypeId:type.id}).where(inArray(skus.id,[f.source.id,f.target.id]));
  const images=await db.insert(productImages).values([0,1].map(()=>{
    const id=createUuidV7();
    return {id,skuId:f.source.id,slot:"MAIN",role:"IDENTITY",usage:"INTERNAL_EVIDENCE",status:"VERIFIED",rawStorageKey:"raw/"+id+"/fixture.jpg",rawSha256:"a".repeat(64),rawBytes:1,mimeType:"image/jpeg",width:1920,height:1080,
      capturedAt:new Date(),deviceId:createUuidV7(),idempotencyKey:id,requestHash:"b".repeat(64),masterVersion:1,masterStorageKey:"master/"+id+"/1.jpg",masterSha256:"c".repeat(64),tier1QualityJson:{passed:true},createdBy:f.actor.userId,verifiedBy:f.actor.userId,verifiedAt:new Date()};
  })).returning();
  await overlap(f.source.id,(tx)=>setPrice(tx,f.actor,{skuId:f.source.id,storefrontId:f.store.id,basePriceMinor:11000}),
    (tx)=>splitSku(tx,f.actor,{sourceSkuId:f.source.id,reason:"Different wheels",targets:[{skuId:f.target.id,claims:{wheel_type:"RUBBER"},imageId:images[0]!.id},{claims:{wheel_type:"IRON"},imageId:images[1]!.id}]}));
  expect(await getCurrentPrice(db,f.source.id,f.store.id)).toBeNull();
});

it("the direct price trigger waits on the same advisory lock before its SKU row lock",async()=>{
  const f=await fixture();
  const tag="m8-trigger-"+createUuidV7();
  let insert:Promise<unknown>|undefined;
  await db.transaction(async(tx)=>{
    await acquireDomainLocks(tx,{advisoryKeys:[priceLockKey(f.source.id)]});
    insert=db.transaction(async(other)=>{
      await other.execute(sql`SELECT set_config('application_name',${tag},true)`);
      await other.execute(sql`SET LOCAL statement_timeout='6s'`);
      return other.execute(sql`INSERT INTO storefront_prices(id,sku_id,storefront_id,kind,base_price_minor,currency,vat_included,set_by,source)
        VALUES(${createUuidV7()},${f.source.id},${f.store.id},'SET',11000,'GEL',true,${f.actor.userId},'MANUAL')`);
    });void insert.catch(()=>{});
    await waitForAdvisory(tag);
    await acquireDomainLocks(tx,{skuIds:[f.source.id]});
  });
  await insert;
  expect(await getCurrentPrice(db,f.source.id,f.store.id)).toMatchObject({basePriceMinor:11000});
});

import { and, eq, inArray, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { auditLogs, getDb, imageMasterVersions, imagePublications, productImages, skuContentApprovals, skuSplitTargets, skus } from "@khidi/db";
import { getContentFactFields, reviewSkuEvidence, submitSkuEvidence } from "@khidi/evidence";
import { createUuidV7 } from "@khidi/shared";
import { attributeSkuAsset, splitSku } from "./corrections.ts";
import { createSkuDraft, getProductTypeByKey, listAccountingMappingsForSku, resolveSkuSlug, setStorefrontListing,
  transitionSkuLifecycle, transitionSkuToReady, upsertAccountingMapping, upsertProductType } from "./index.ts";

const db = getDb();
async function fixture() {
  const admin = (await db.query.users.findFirst({ where: (row,{eq})=>eq(row.role,"ADMIN") }))!;
  const store = (await db.query.storefronts.findFirst())!;
  const actor = { userId: admin.id };
  const template = await getProductTypeByKey(db,"MOTOBLOCK");
  const type = await upsertProductType(db,actor,{...template,key:"SPLIT_"+createUuidV7().slice(-9),
    distinguishingAttributes:["wheel_type","power_kw"]});
  const source = await createSkuDraft(db,actor,{productTypeId:type.id});
  async function photo() {
    const id = createUuidV7();
    await db.insert(productImages).values({id,skuId:source.id,slot:"MAIN",role:"MAIN",usage:"PUBLIC",status:"VERIFIED",
      rawStorageKey:"raw/"+id+"/fixture.jpg",rawSha256:"a".repeat(64),rawBytes:1,mimeType:"image/jpeg",width:1920,height:1080,
      capturedAt:new Date(),deviceId:createUuidV7(),idempotencyKey:id,requestHash:"b".repeat(64),
      masterStorageKey:"master/"+id+"/1.jpg",masterSha256:"c".repeat(64),masterVersion:1,tier1QualityJson:{passed:true},
      createdBy:admin.id,verifiedBy:admin.id,verifiedAt:new Date()});
    await db.insert(imageMasterVersions).values({id:createUuidV7(),imageId:id,version:1,
      sha256:"c".repeat(64),bytes:1,width:1920,height:1920,derivativesJson:{},storageKey:"master/"+id+"/v1/master.jpg"});
    return id;
  }
  const photos = [await photo(),await photo()];
  const targets = [{claims:{wheel_type:"RUBBER"},imageId:photos[0]}, {claims:{wheel_type:"IRON"},imageId:photos[1]}];
  return {actor,store,type,source,photos,targets};
}

it("rejects inactive sources, non-admins, inventory history and targets without a differing basis",async()=>{
  const f=await fixture();
  const input={sourceSkuId:f.source.id,targets:f.targets,reason:"Compared the actual wheel variants"};
  const operator=(await db.query.users.findFirst({where:(row,{eq})=>eq(row.role,"OPERATOR")}))!;
  await expect(splitSku(db,{userId:operator.id},input)).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(splitSku(db,f.actor,{...input,targets:[f.targets[0],f.targets[0]]})).rejects.toThrow(/differing value/);
  await expect(db.transaction(async(tx)=>{
    await tx.execute(sql`CREATE TEMP TABLE stock_ledger (sku_id uuid) ON COMMIT DROP`);
    await tx.execute(sql`INSERT INTO stock_ledger VALUES (${f.source.id}::uuid)`);
    return splitSku(tx,f.actor,input);
  })).rejects.toThrow(/ADR-011 Part B/);
  await transitionSkuLifecycle(db,f.actor,f.source.id,"ARCHIVED");
  await expect(splitSku(db,f.actor,input)).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
  const predecessor=await createSkuDraft(db,f.actor,{productTypeId:f.type.id});
  await db.update(skus).set({lifecycleState:"ARCHIVED",mergedIntoSkuId:f.source.id}).where(eq(skus.id,predecessor.id));
  await expect(splitSku(db,f.actor,{...input,sourceSkuId:predecessor.id})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
});

it("archives the source, preserves its history and requires explicit evidence and image attributions",async()=>{
  const f=await fixture();
  const slug="split-source-"+createUuidV7().slice(-9);
  await db.update(skus).set({lifecycleState:"READY",canonicalSlug:slug,reverificationRequired:true}).where(eq(skus.id,f.source.id));
  await setStorefrontListing(db,f.actor,{skuId:f.source.id,storefrontId:f.store.id,enabled:true});
  const claims={weight_kg:40};
  const proof=await submitSkuEvidence(db,f.actor,{skuId:f.source.id,type:"FACTORY_SPEC_SHEET",claims});
  await reviewSkuEvidence(db,f.actor,{evidenceId:proof.id,status:"ACCEPTED",claims,reason:"Reviewed original sheet"});
  const split=await splitSku(db,f.actor,{sourceSkuId:f.source.id,targets:f.targets,reason:"Confirmed rubber and iron wheels"});
  const [left,right]=split.targetSkuIds as [string,string];
  expect(await resolveSkuSlug(db,slug)).toEqual({redirectTargetType:"CATEGORY",categoryId:f.type.defaultCategoryId,redirected:true});
  expect(await db.query.skus.findFirst({where:(row,{eq})=>eq(row.id,f.source.id)})).toMatchObject({lifecycleState:"ARCHIVED",canonicalSlug:slug,mergedIntoSkuId:null});
  expect(await db.query.storefrontListings.findFirst({where:(row,{eq})=>eq(row.skuId,f.source.id)})).toMatchObject({enabled:false});
  expect(await db.select().from(skuSplitTargets).where(eq(skuSplitTargets.sourceSkuId,f.source.id))).toHaveLength(2);
  expect((await getContentFactFields(db,left)).get("weight_kg")?.status).not.toBe("VERIFIED");
  await attributeSkuAsset(db,f.actor,{sourceSkuId:f.source.id,targetSkuId:left,kind:"EVIDENCE",assetId:proof.id,reason:"The sheet describes the rubber-wheel unit"});
  expect((await getContentFactFields(db,left)).get("weight_kg")).toMatchObject({value:40,status:"VERIFIED"});
  expect((await getContentFactFields(db,right)).get("weight_kg")?.status).not.toBe("VERIFIED");
  expect(await db.query.evidence.findFirst({where:(row,{eq})=>eq(row.id,proof.id)})).toMatchObject({skuId:f.source.id,status:"ACCEPTED",claims});
  expect(await db.query.productImages.findFirst({where:(row,{eq})=>eq(row.id,f.photos[0]!)})).toMatchObject({skuId:f.source.id});
  const publication={id:createUuidV7(),imageId:f.photos[0]!,skuId:left,masterVersion:1,objectKey:"split-fixture-1-400.webp",width:400,format:"webp",sha256:"d".repeat(64),status:"PENDING"};
  await db.insert(imagePublications).values(publication);
  await expect(db.insert(imagePublications).values({...publication,id:createUuidV7(),skuId:right,objectKey:"split-fixture-2-400.webp"})).rejects.toThrow(/attribution/);
  expect(await db.select().from(skuContentApprovals).where(inArray(skuContentApprovals.skuId,split.targetSkuIds))).toEqual([]);
  const audits=await db.select().from(auditLogs).where(eq(auditLogs.action,"SKU_SPLIT"));
  expect(audits).toContainEqual(expect.objectContaining({entityId:f.source.id,actorUserId:f.actor.userId,reason:"Confirmed rubber and iron wheels"}));
  expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId,left),eq(auditLogs.action,"SKU_ASSET_ATTRIBUTED"))))
    .toEqual(expect.arrayContaining([expect.objectContaining({afterJson:expect.objectContaining({assetId:proof.id})})]));
});

it("requires support for non-observable candidates and leaves them unverified and blocked from READY",async()=>{
  const f=await fixture();
  const first=await submitSkuEvidence(db,f.actor,{skuId:f.source.id,type:"STAFF_STATEMENT",claims:{power_kw:5.15}});
  const second=await submitSkuEvidence(db,f.actor,{skuId:f.source.id,type:"STAFF_STATEMENT",claims:{power_kw:6.62}});
  const targets=[{claims:{power_kw:5.15},supports:{power_kw:[first.id]}},{claims:{power_kw:6.62},supports:{power_kw:[second.id]}}];
  await expect(splitSku(db,f.actor,{sourceSkuId:f.source.id,targets:[{claims:{power_kw:5.15}},targets[1]],reason:"Read different carton ratings"}))
    .rejects.toThrow(/supporting evidence/);
  const split=await splitSku(db,f.actor,{sourceSkuId:f.source.id,targets,reason:"Read different carton ratings"});
  for(const id of split.targetSkuIds){
    expect((await getContentFactFields(db,id)).get("power_kw")?.status).toBe("UNVERIFIED");
    expect(await db.query.skus.findFirst({where:(row,{eq})=>eq(row.id,id)})).toMatchObject({splitBasisUnverified:true,lifecycleState:"INTAKE",identityConfidence:"LOW"});
    for(const state of ["IDENTIFIED","CONTENT_GENERATING","CONTENT_REVIEW"]as const)await transitionSkuLifecycle(db,f.actor,id,state);
    await expect(transitionSkuToReady(db,f.actor,id)).rejects.toThrow(/identity_confidence="LOW"/);
  }
});

it("requires explicit shared accounting confirmation and flags both active targets",async()=>{
  const f=await fixture();
  const split=await splitSku(db,f.actor,{sourceSkuId:f.source.id,targets:f.targets,reason:"Distinct wheel variants"});
  const mapping={legalEntityId:f.store.sellerEntityId,accountingItemId:"SHARED-"+createUuidV7(),accountingName:"Shared source accounting fixture"};
  await upsertAccountingMapping(db,f.actor,{...mapping,skuId:split.targetSkuIds[0]!});
  await expect(upsertAccountingMapping(db,f.actor,{...mapping,skuId:split.targetSkuIds[1]!})).rejects.toThrow(/shared/);
  await upsertAccountingMapping(db,f.actor,{...mapping,skuId:split.targetSkuIds[1]!,confirmSharedAccountingItem:true});
  for(const id of split.targetSkuIds)expect((await listAccountingMappingsForSku(db,id))[0]?.sharedAccountingItem).toBe(true);
});

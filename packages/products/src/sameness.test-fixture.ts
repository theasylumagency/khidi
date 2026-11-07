import { and, eq, inArray } from "drizzle-orm";
import { productImages, skus, type DbExecutor, type EvidenceValue } from "@khidi/db";
import { submitSkuEvidence, reviewSkuEvidence } from "@khidi/evidence";
import { createUuidV7 } from "@khidi/shared";
import { getProductTypeByKey, upsertProductType } from "./index.ts";

export async function makeSamenessFixture(db:DbExecutor,actor:{userId:string},sourceSkuId:string,targetSkuId:string,
  options:{claims?:Record<string,EvidenceValue>;unknowns?:Record<string,string>;accept?:boolean}={}) {
  const pair=await db.select().from(skus).where(inArray(skus.id,[sourceSkuId,targetSkuId]));
  let typeId=pair.find((sku)=>sku.productTypeId)?.productTypeId;
  if(!typeId){
    const template=await getProductTypeByKey(db,"MOTOBLOCK");
    const type=await upsertProductType(db,actor,{...template,key:"SAMENESS_FIXTURE_"+createUuidV7().slice(-9),
      attributeSchemaJson:[],distinguishingAttributes:[]});
    typeId=type.id;
  }
  await db.update(skus).set({productTypeId:typeId}).where(inArray(skus.id,[sourceSkuId,targetSkuId]));
  async function photo(skuId:string){
    const [existing]=await db.select().from(productImages).where(and(eq(productImages.skuId,skuId),eq(productImages.status,"VERIFIED")));
    if(existing)return existing.id;
    const id=createUuidV7();
    await db.insert(productImages).values({id,skuId,slot:"MAIN",role:"IDENTITY",usage:"INTERNAL_EVIDENCE",status:"VERIFIED",
      rawStorageKey:"raw/"+id+"/fixture.jpg",rawSha256:"a".repeat(64),rawBytes:1,mimeType:"image/jpeg",width:1920,height:1080,
      capturedAt:new Date(),deviceId:createUuidV7(),idempotencyKey:id,requestHash:"b".repeat(64),
      masterStorageKey:"master/"+id+"/v1/master.jpg",masterSha256:"c".repeat(64),masterVersion:1,
      tier1QualityJson:{passed:true},createdBy:actor.userId,verifiedBy:actor.userId,verifiedAt:new Date()});
    return id;
  }
  const item=await submitSkuEvidence(db,actor,{skuId:sourceSkuId,comparisonSkuId:targetSkuId,
    comparisonRelation:"MATCHES",type:"ADMIN_PHYSICAL_INSPECTION",imageId:await photo(sourceSkuId),
    comparisonImageId:await photo(targetSkuId),claims:options.claims??{},comparisonClaims:options.claims??{},
    acknowledgedUnknowns:options.unknowns??{},notes:"Compared the two fixture units from the same angle"});
  if(options.accept!==false)await reviewSkuEvidence(db,actor,{evidenceId:item.id,status:"ACCEPTED",
    claims:item.claims,reason:"Confirmed each observation on both products"});
  return item;
}

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  evidence, evidenceAttributions, getSkuImages, getSkuLineageIds, imageAttributions, imageBelongsToSku,
  productTypes, skuContentVersions, skuSlugHistory, skuSplitBasis, skuSplitTargets, skus, storefrontListings, users,
  type DbExecutor
} from "@khidi/db";
import { withDomainTransaction, type DomainActor, type DomainTransactionContext } from "@khidi/domain";
import { evidenceValuesDiffer, loadSkuEvidenceSources, lockIdentityCatalog, recomputeSkuIdentity,
  reviewSkuEvidence, submitSkuEvidence, UNIVERSAL_EVIDENCE_FIELDS } from "@khidi/evidence";
import { queueMediaJob } from "@khidi/media";
import { AppError, createUuidV7 } from "@khidi/shared";
import { createSkuDraft, setStorefrontListing, transitionSkuLifecycle } from "./index.ts";
import { saveCanonicalVersion } from "./content.ts";

const reasonSchema = z.string().trim().min(1).max(4000);
const valuesSchema = z.record(z.string(), z.union([z.string().min(1).max(400), z.number().finite(), z.boolean()]));
const attributionSchema = z.object({
  sourceSkuId: z.string().uuid(), targetSkuId: z.string().uuid(), kind: z.enum(["EVIDENCE","IMAGE"]),
  assetId: z.string().uuid(), claimSkuId: z.string().uuid().optional(), reason: reasonSchema
}).strict();

async function requireAdmin(ctx: DomainTransactionContext, actor: DomainActor) {
  const [admin] = actor.userId ? await ctx.tx.select({ id: users.id }).from(users)
    .where(and(eq(users.id,actor.userId),eq(users.role,"ADMIN"),eq(users.active,true))) : [];
  if (!admin) throw new AppError("FORBIDDEN","Catalog corrections require an active admin.");
  return admin.id;
}

async function attribute(ctx: DomainTransactionContext, adminId: string, input: z.infer<typeof attributionSchema>) {
  const [relation] = await ctx.tx.select().from(skuSplitTargets).where(and(
    eq(skuSplitTargets.sourceSkuId,input.sourceSkuId),eq(skuSplitTargets.targetSkuId,input.targetSkuId)));
  if (!relation) throw new AppError("PRECONDITION_FAILED","Choose a target of this split.");
  const metadata = { sourceSkuId: input.sourceSkuId,targetSkuId: input.targetSkuId,attributedBy: adminId,reason: input.reason };
  if (input.kind === "IMAGE") {
    if (!await imageBelongsToSku(ctx.tx,input.assetId,input.sourceSkuId)) throw new AppError("VALIDATION_ERROR","Image does not belong to the split source.");
    const inserted = await ctx.tx.insert(imageAttributions).values({ ...metadata,imageId:input.assetId }).onConflictDoNothing().returning();
    if (!inserted.length) return;
  } else {
    const sources = await loadSkuEvidenceSources(ctx.tx,await getSkuLineageIds(ctx.tx,input.sourceSkuId));
    const item = sources.find((item)=>item.id===input.assetId && (!input.claimSkuId || item.claimSkuId===input.claimSkuId));
    if (!item) throw new AppError("VALIDATION_ERROR","Evidence does not belong to the split source.");
    const inserted = await ctx.tx.insert(evidenceAttributions).values({ ...metadata,evidenceId:item.id,
      claimSkuId:item.claimSkuId??item.skuId }).onConflictDoNothing().returning();
    if (!inserted.length) return;
  }
  await ctx.recordAudit({action:"SKU_ASSET_ATTRIBUTED",entityType:"sku",entityId:input.targetSkuId,
    after:{ sourceSkuId:input.sourceSkuId,kind:input.kind,assetId:input.assetId,claimSkuId:input.claimSkuId },reason:input.reason});
  await ctx.emitOutboxEvent({eventType:"PRODUCT_UPDATED",aggregateType:"sku",aggregateId:input.targetSkuId,
    payload:{ attributedAssetId:input.assetId,kind:input.kind },consumers:[]});
}

export async function attributeSkuAsset(db: DbExecutor, actor: DomainActor, raw: unknown) {
  const parsed = attributionSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR","Attribution requires a source, target, asset and reason.");
  return withDomainTransaction(db,actor,async(ctx)=>{
    await lockIdentityCatalog(ctx.tx);
    await attribute(ctx,await requireAdmin(ctx,actor),parsed.data);
    await recomputeSkuIdentity(ctx,parsed.data.targetSkuId);
    await queueMediaJob(ctx,"publish-sku-media",{skuId:parsed.data.targetSkuId});
    return {id:parsed.data.targetSkuId};
  });
}

const splitInput = z.object({
  sourceSkuId:z.string().uuid(),reason:reasonSchema,
  targets:z.array(z.object({
    skuId:z.string().uuid().optional(),claims:valuesSchema,
    imageId:z.string().uuid().optional(),imageIds:z.array(z.string().uuid()).default([]),
    evidenceIds:z.array(z.string().uuid()).default([]),
    supports:z.record(z.string(),z.array(z.string().uuid()).min(1)).default({}),
    copyLocales:z.array(z.string()).max(10).default([])
  }).strict()).min(2).max(10)
}).strict();

export async function splitSku(db: DbExecutor,actor:DomainActor,raw:unknown) {
  const parsed=splitInput.safeParse(raw);
  if(!parsed.success)throw new AppError("VALIDATION_ERROR","Define at least two split targets, their differing readings and a reason.");
  const input=parsed.data;
  return withDomainTransaction(db,actor,async(ctx)=>{
    await lockIdentityCatalog(ctx.tx);
    const adminId=await requireAdmin(ctx,actor);
    const [source]=await ctx.tx.select().from(skus).where(eq(skus.id,input.sourceSkuId)).for("update");
    if(!source || source.lifecycleState==="ARCHIVED" || source.mergedIntoSkuId)throw new AppError("PRECONDITION_FAILED","Only an active SKU can be split.");
    const [type]=source.productTypeId?await ctx.tx.select().from(productTypes).where(eq(productTypes.id,source.productTypeId)):[];
    if(!type)throw new AppError("PRECONDITION_FAILED","Classify the source Product Type before splitting.");
    const lineage=await getSkuLineageIds(ctx.tx,source.id);
    try {
      await ctx.tx.execute(sql`SELECT assert_sku_preinventory(ARRAY[${sql.join(lineage.map((id)=>sql`${id}::uuid`),sql`,`)}])`);
    } catch(error) {
      if(error instanceof Error && error.message.includes("ADR-011 Part B")) {
        throw new AppError("PRECONDITION_FAILED","ADR-011 Part B: SKU has inventory or fulfillment history.");
      }
      throw error;
    }
    const observable=(key:string)=>!UNIVERSAL_EVIDENCE_FIELDS.some((field)=>field===key)
      && type.attributeSchemaJson.some((field)=>field.key===key&&field.observable);
    const targets:{input:z.infer<typeof splitInput>["targets"][number];sku:typeof skus.$inferSelect}[]=[];
    for(const target of input.targets){
      const sku=target.skuId
        ? (await ctx.tx.select().from(skus).where(eq(skus.id,target.skuId)))[0]
        : await createSkuDraft(ctx.tx,actor,{productTypeId:type.id,productFamilyId:source.productFamilyId});
      if(!sku || sku.id===source.id || sku.lifecycleState==="ARCHIVED" || sku.productTypeId!==type.id
        || targets.some((target)=>target.sku.id===sku.id))throw new AppError("VALIDATION_ERROR","Choose distinct active targets of the same Product Type.");
      if(!Object.keys(target.claims).length)throw new AppError("VALIDATION_ERROR","Each target needs a distinguishing basis.");
      for(const [key,value]of Object.entries(target.claims)){
        const field=type.attributeSchemaJson.find((field)=>field.key===key);
        if(!observable(key)&&!type.distinguishingAttributes.includes(key))throw new AppError("VALIDATION_ERROR","Choose a distinguishing or observable field.");
        const kind=field?.dataType??(UNIVERSAL_EVIDENCE_FIELDS.some((field)=>field===key)?"number":undefined);
        if((kind==="enum"&&(!field?.enumValues?.includes(String(value))))
          || (kind!=="enum"&&typeof value!==kind))throw new AppError("VALIDATION_ERROR","Invalid split field value.");
        if(!observable(key)){
          const support=target.supports[key]??[];
          const records=support.length?await ctx.tx.select({id:evidence.id}).from(evidence).where(inArray(evidence.id,support)):[];
          if(!support.length||new Set(records.map((row)=>row.id)).size!==new Set(support).size)
            throw new AppError("VALIDATION_ERROR","Non-observable split values require existing supporting evidence.");
        }
      }
      targets.push({input:target,sku});
    }
    const pairs=[];
    for(let left=0;left<targets.length;left++)for(let right=left+1;right<targets.length;right++){
      const a=targets[left]!,b=targets[right]!;
      const fields=Object.keys(a.input.claims).filter((key)=>Object.hasOwn(b.input.claims,key)
        && evidenceValuesDiffer(a.input.claims[key]!,b.input.claims[key]!));
      if(!fields.length)throw new AppError("VALIDATION_ERROR","Each pair of targets needs a differing value for the same field.");
      pairs.push({a,b,fields});
    }
    await transitionSkuLifecycle(ctx.tx,actor,source.id,"ARCHIVED",{reason:input.reason});
    const listings=await ctx.tx.select().from(storefrontListings).where(and(eq(storefrontListings.skuId,source.id),eq(storefrontListings.enabled,true)));
    for(const listing of listings)await setStorefrontListing(ctx.tx,actor,{skuId:source.id,storefrontId:listing.storefrontId,enabled:false,reason:input.reason});
    if(source.canonicalSlug){
      const [old]=await ctx.tx.select().from(skuSlugHistory).where(eq(skuSlugHistory.oldSlug,source.canonicalSlug));
      if(!old)await ctx.tx.insert(skuSlugHistory).values({id:createUuidV7(),skuId:source.id,oldSlug:source.canonicalSlug,
        redirectTargetType:"CATEGORY",redirectCategoryId:type.defaultCategoryId});
    }
    await ctx.tx.insert(skuSplitTargets).values(targets.map(({sku})=>({sourceSkuId:source.id,targetSkuId:sku.id,createdBy:adminId})));
    for(const target of targets){
      for(const imageId of new Set([...target.input.imageIds,...(target.input.imageId?[target.input.imageId]:[])]))
        if(!await imageBelongsToSku(ctx.tx,imageId,target.sku.id))
          await attribute(ctx,adminId,{sourceSkuId:source.id,targetSkuId:target.sku.id,kind:"IMAGE",assetId:imageId,reason:input.reason});
      for(const evidenceId of target.input.evidenceIds)
        await attribute(ctx,adminId,{sourceSkuId:source.id,targetSkuId:target.sku.id,kind:"EVIDENCE",assetId:evidenceId,reason:input.reason});
      for(const locale of target.input.copyLocales){
        const [version]=await ctx.tx.select().from(skuContentVersions).where(and(eq(skuContentVersions.skuId,source.id),eq(skuContentVersions.locale,locale)))
          .orderBy(sql`${skuContentVersions.createdAt} DESC`).limit(1);
        if(version)await saveCanonicalVersion(ctx.tx,actor,{skuId:target.sku.id,locale,
          draft:{displayName:version.displayName,shortDescription:version.shortDescription,fullDescription:version.fullDescription,searchAliases:version.searchAliases}});
      }
    }
    for(const {a,b,fields}of pairs)for(const observed of [true,false]){
      const keys=fields.filter((key)=>observable(key)===observed);
      if(!keys.length)continue;
      const item=await submitSkuEvidence(ctx.tx,actor,{
        skuId:a.sku.id,comparisonSkuId:b.sku.id,type:observed?"ADMIN_PHYSICAL_INSPECTION":"STAFF_STATEMENT",
        comparisonRelation:"DIFFERS",notes:input.reason,
        claims:Object.fromEntries(keys.map((key)=>[key,a.input.claims[key]])),
        comparisonClaims:Object.fromEntries(keys.map((key)=>[key,b.input.claims[key]])),
        ...(observed?{imageId:a.input.imageId,comparisonImageId:b.input.imageId}:{
          supportingEvidenceIds:[...new Set(keys.flatMap((key)=>a.input.supports[key]??[]))],
          comparisonSupportingEvidenceIds:[...new Set(keys.flatMap((key)=>b.input.supports[key]??[]))]
        })
      });
      if(observed)await reviewSkuEvidence(ctx.tx,actor,{evidenceId:item.id,status:"ACCEPTED",claims:item.claims,
        comparisonClaims:item.comparisonClaims,reason:input.reason});
      for(const target of [a,b])await ctx.tx.insert(skuSplitBasis).values(keys.map((fieldName)=>({
        sourceSkuId:source.id,targetSkuId:target.sku.id,fieldName,value:target.input.claims[fieldName]!,evidenceId:item.id
      }))).onConflictDoNothing();
    }
    for(const {sku}of targets)await recomputeSkuIdentity(ctx,sku.id);
    await ctx.recordAudit({action:"SKU_SPLIT",entityType:"sku",entityId:source.id,
      before:{state:source.lifecycleState,slug:source.canonicalSlug},after:{targetSkuIds:targets.map(({sku})=>sku.id),basis:input.targets.map(({claims,supports})=>({claims,supports}))},reason:input.reason});
    await ctx.emitOutboxEvent({eventType:"PRODUCT_UPDATED",aggregateType:"sku",aggregateId:source.id,
      payload:{splitTargetSkuIds:targets.map(({sku})=>sku.id)},consumers:[]});
    return {sourceSkuId:source.id,targetSkuIds:targets.map(({sku})=>sku.id)};
  });
}

export async function getSkuCorrectionContext(db:DbExecutor,sourceSkuId:string){
  const [source]=await db.select().from(skus).where(eq(skus.id,sourceSkuId));
  if(!source)throw new AppError("NOT_FOUND","SKU not found.");
  const [targets,images,evidenceItems]=await Promise.all([
    db.select({id:skus.id,internalSku:skus.internalSku}).from(skus).where(and(ne(skus.id,source.id),ne(skus.lifecycleState,"ARCHIVED"),
      source.productTypeId?eq(skus.productTypeId,source.productTypeId):sql`FALSE`)),
    getSkuImages(db,source.id),loadSkuEvidenceSources(db,await getSkuLineageIds(db,source.id))
  ]);
  const splitTargets=await db.select({id:skus.id,internalSku:skus.internalSku}).from(skuSplitTargets)
    .innerJoin(skus,eq(skus.id,skuSplitTargets.targetSkuId)).where(eq(skuSplitTargets.sourceSkuId,source.id));
  return {source,targets,images,evidenceItems,splitTargets};
}

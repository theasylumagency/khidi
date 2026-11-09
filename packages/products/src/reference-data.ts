import { eq,inArray } from "drizzle-orm";
import { categories,productTypes,skus,type DbExecutor, type ProductTypeAttributeFieldDef as Field } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { acquireDomainLocks } from "@khidi/domain/locking";
import { lockIdentityCatalog,recomputeSkuIdentity,withDefaultObservableAttributes,UNIVERSAL_EVIDENCE_FIELDS } from "@khidi/evidence";
import { createUuidV7 } from "@khidi/shared";
import { INITIAL_CATEGORIES,INITIAL_PRODUCT_TYPES,type ProductTypeSeedDef } from "./taxonomy.ts";
export const REFERENCE_CATALOG_VERSION="catalog-2026-11-08-h10";
const same=(a:unknown,b:unknown):boolean=>{
 if(a===b)return true;if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>same(v,b[i]));
 if(a&&b&&typeof a==="object"&&typeof b==="object") {const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left);return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&same(left[key],right[key]));}return false;
};
/** Append owner-approved fields/requirements without losing intake-added subtypes or custom fields. */
export function mergeReferenceFields(existing:Field[],approved:Field[]):Field[] {
 const merged=approved.map(field=>{
  const old=existing.find(f=>f.key===field.key);if(!old||field.dataType!=="enum")return field;
  return {...field,enumValues:[...new Set([...(field.enumValues??[]),...(old.enumValues??[])])],
   ...((field.enumValueMetadata||old.enumValueMetadata)?{enumValueMetadata:{...old.enumValueMetadata,...field.enumValueMetadata}}:{})};
 });
 return [...merged,...existing.filter(field=>!approved.some(f=>f.key===field.key))];
}
function typeValues(def:ProductTypeSeedDef,categoryId:string,existing?:typeof productTypes.$inferSelect) {
 const fields=mergeReferenceFields(existing?.attributeSchemaJson??[],withDefaultObservableAttributes(def.attributeSchema));
 const defaultDistinguishing=def.key==="MOTOBLOCK"?["fuel_type","power_kw","transmission_gears","wheel_type"]:def.attributeSchema.filter(f=>f.tier==="REQUIRED_IDENTITY").map(f=>f.key);
 return {defaultCategoryId:categoryId,nameKa:def.nameKa,nameEn:def.nameEn,attributeSchemaJson:fields,
  photoInstructionsJson:def.photoInstructions,namingTemplateKa:def.namingTemplateKa,namingTemplateEn:def.namingTemplateEn,
  aiResearchContractJson:def.aiResearchContract,searchAliasesKa:def.searchAliasesKa,searchAliasesEn:def.searchAliasesEn,
  distinguishingAttributes:[...new Set([...defaultDistinguishing,...(existing?.distinguishingAttributes??[]).filter(key=>def.key!=="SPARE_PART"||key!=="compatible_engine_or_machine")])]};
}
/** Operations-only reference package. Contains no customers, users, entities, stores, stock or settings. */
export async function applyReferenceCatalog(db:DbExecutor,apply=false) {
 for(const type of INITIAL_PRODUCT_TYPES) {
  const keys=new Set([...type.attributeSchema.map(field=>field.key),...UNIVERSAL_EVIDENCE_FIELDS]);
  for(const field of type.attributeSchema)for(const [value,metadata]of Object.entries(field.enumValueMetadata??{}))
   if(!field.enumValues?.includes(value)||metadata.requiredSpecFields.some(key=>!keys.has(key)))throw new Error("Invalid approved subtype/specification reference contract.");
 }
 return withDomainTransaction(db,{principalType:"SYSTEM_WORKFLOW",principalId:createUuidV7()},async ctx=>{
  await lockIdentityCatalog(ctx.tx);
  const categoryRows=await ctx.tx.select().from(categories),typeRows=await ctx.tx.select().from(productTypes);
  const ids=new Map(categoryRows.map(row=>[row.key,row.id]));
  const changes:{kind:string;key:string;fields:string[]}[]=[],changedTypes:string[]=[];
  for(const def of INITIAL_CATEGORIES) {
   const old=categoryRows.find(row=>row.key===def.key),id=old?.id??createUuidV7();ids.set(def.key,id);
   const values={nameKa:def.nameKa,nameEn:def.nameEn,isUnclassified:def.isUnclassified,sortOrder:def.sortOrder,parentId:null};
   const fields=old?Object.keys(values).filter(key=>!same(old[key as keyof typeof old],values[key as keyof typeof values])):Object.keys(values);
   if(!fields.length)continue;changes.push({kind:"category",key:def.key,fields});if(!apply)continue;
   if(old)await ctx.tx.update(categories).set(values).where(eq(categories.id,id));else await ctx.tx.insert(categories).values({id,key:def.key,...values});
   await ctx.recordAudit({action:"REFERENCE_CATEGORY_APPLIED",entityType:"category",entityId:id,before:old??null,after:{...values,version:REFERENCE_CATALOG_VERSION}});
   await ctx.emitOutboxEvent({eventType:"REFERENCE_DATA_UPDATED",aggregateType:"category",aggregateId:id,payload:{key:def.key,version:REFERENCE_CATALOG_VERSION},consumers:[]});
  }
  for(const def of INITIAL_PRODUCT_TYPES) {
   const old=typeRows.find(row=>row.key===def.key),id=old?.id??createUuidV7(),values=typeValues(def,ids.get(def.defaultCategoryKey)!,old);
   const fields=old?Object.keys(values).filter(key=>!same(old[key as keyof typeof old],values[key as keyof typeof values])):Object.keys(values);
   if(!fields.length)continue;changes.push({kind:"product_type",key:def.key,fields});if(!apply)continue;
   if(old)await ctx.tx.update(productTypes).set({...values,updatedAt:new Date()}).where(eq(productTypes.id,id));else await ctx.tx.insert(productTypes).values({id,key:def.key,...values});
   if(old&&(fields.includes("attributeSchemaJson")||fields.includes("distinguishingAttributes")))changedTypes.push(id);
   await ctx.recordAudit({action:"REFERENCE_PRODUCT_TYPE_APPLIED",entityType:"product_type",entityId:id,before:old??null,after:{...values,version:REFERENCE_CATALOG_VERSION}});
   await ctx.emitOutboxEvent({eventType:"REFERENCE_DATA_UPDATED",aggregateType:"product_type",aggregateId:id,payload:{key:def.key,version:REFERENCE_CATALOG_VERSION},consumers:[]});
  }
  if(changedTypes.length) {
   const affected=await ctx.tx.select({id:skus.id}).from(skus).where(inArray(skus.productTypeId,changedTypes));
   await acquireDomainLocks(ctx.tx,{skuIds:affected.map(sku=>sku.id)});for(const sku of affected)await recomputeSkuIdentity(ctx,sku.id);
  }
  return {version:REFERENCE_CATALOG_VERSION,apply,changes};
 });
}

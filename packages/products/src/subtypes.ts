import { and,eq } from "drizzle-orm";
import { z } from "zod";
import { productTypes,users,type DbExecutor } from "@khidi/db";
import { withDomainTransaction,type DomainActor } from "@khidi/domain";
import { lockIdentityCatalog } from "@khidi/evidence";
import { AppError } from "@khidi/shared";
export const EDITABLE_SUBTYPE_FIELDS={ACCESSORY:"consumable_kind",POWER_TOOL:"tool_kind",FARM_PROCESSOR:"processor_kind"} as const;
export const addSubtypeSchema=z.object({productTypeKey:z.enum(["ACCESSORY","POWER_TOOL","FARM_PROCESSOR"]),key:z.string().trim().min(2).max(48).regex(/^[A-Z][A-Z0-9_]*$/),labelKa:z.string().trim().min(1).max(120),labelEn:z.string().trim().min(1).max(120)}).strict();
export async function addProductSubtype(db:DbExecutor,actor:DomainActor,raw:unknown) {
 const parsed=addSubtypeSchema.safeParse(raw);if(!parsed.success)throw new AppError("VALIDATION_ERROR","Invalid subtype.");const input=parsed.data;
 return withDomainTransaction(db,actor,async ctx=>{
  const [admin]=actor.userId?await ctx.tx.select({id:users.id}).from(users).where(and(eq(users.id,actor.userId),eq(users.active,true),eq(users.role,"ADMIN"))):[];
  if(!admin)throw new AppError("FORBIDDEN","Admin required.");
  await lockIdentityCatalog(ctx.tx);
  const [type]=await ctx.tx.select().from(productTypes).where(eq(productTypes.key,input.productTypeKey)).for("update");
  if(!type)throw new AppError("PRECONDITION_FAILED","Apply reference data first.");
  const fieldKey=EDITABLE_SUBTYPE_FIELDS[input.productTypeKey],field=type.attributeSchemaJson.find(f=>f.key===fieldKey);
  if(field?.dataType!=="enum"||!field.enumValues)throw new AppError("PRECONDITION_FAILED","Controlled subtype field required.");
  if(field.enumValues.includes(input.key))throw new AppError("CONFLICT","Subtype key already exists.");
  if(field.enumValues.length>=1000)throw new AppError("VALIDATION_ERROR","Subtype limit reached.");
  const metadata={labelKa:input.labelKa,labelEn:input.labelEn,requiredSpecFields:[]};
  const schema=type.attributeSchemaJson.map(f=>f.key===fieldKey?{...f,enumValues:[...field.enumValues!,input.key],enumValueMetadata:{...f.enumValueMetadata,[input.key]:metadata}}:f);
  await ctx.tx.update(productTypes).set({attributeSchemaJson:schema,updatedAt:new Date()}).where(eq(productTypes.id,type.id));
  await ctx.recordAudit({action:"PRODUCT_SUBTYPE_ADDED",entityType:"product_type",entityId:type.id,before:{attributeSchema:type.attributeSchemaJson},after:{key:input.key,attributeSchema:schema},reason:"Intake subtype; required specifications await owner definition."});
  await ctx.emitOutboxEvent({eventType:"PRODUCT_UPDATED",aggregateType:"product_type",aggregateId:type.id,payload:{subtype:input.key},consumers:[]});
  return {id:type.id,key:input.key};
 });
}

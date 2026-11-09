import { expect,it } from "vitest";
import { eq,sql } from "drizzle-orm";
import { getDb,users,legalEntities,storefronts,stockPools,allocations,registeredDevices,systemSettings,categories,productTypes,auditLogs,outboxEvents } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import { applyReferenceCatalog,mergeReferenceFields } from "./reference-data.ts";
import { referenceCommand } from "./reference-command.ts";
import { addProductSubtype } from "./subtypes.ts";
import { INITIAL_CATEGORIES,INITIAL_PRODUCT_TYPES } from "./taxonomy.ts";
it("installs only 8 public categories, UNCLASSIFIED and the 33 approved types; preview/replay never create business fixtures",async()=>{
 const db=getDb();await db.transaction(async tx=>{
  for(const table of ["categories","product_types","audit_logs","outbox_events","outbox_deliveries"])await tx.execute(sql.raw(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`));
  const counts=()=>Promise.all([users,legalEntities,storefronts,stockPools,allocations,registeredDevices,systemSettings].map(table=>tx.select({count:sql<number>`count(*)::integer`}).from(table)));
  const before=await counts();expect((await applyReferenceCatalog(tx)).changes).toHaveLength(42);expect(await tx.select().from(productTypes)).toHaveLength(0);
  const result=await applyReferenceCatalog(tx,true);expect(result.changes).toHaveLength(42);
  expect(await tx.select().from(categories)).toHaveLength(9);expect(await tx.select().from(productTypes)).toHaveLength(33);
  expect(await counts()).toEqual(before);expect(await tx.select().from(auditLogs)).toHaveLength(42);expect(await tx.select().from(outboxEvents)).toHaveLength(42);
  expect((await applyReferenceCatalog(tx,true)).changes).toEqual([]);expect(await tx.select().from(auditLogs)).toHaveLength(42);
  expect(INITIAL_CATEGORIES.filter(c=>!c.isUnclassified)).toHaveLength(8);
  for(const key of ["GENERATOR","LADDER","CONSUMABLE"])expect(INITIAL_PRODUCT_TYPES.some(type=>type.key===key)).toBe(true);
 });
});
it("keeps intake-added controlled subtypes across reference updates and can later add approved required fields without schema changes",async()=>{
 const db=getDb(),admin=await db.query.users.findFirst({where:(u,{and,eq})=>and(eq(u.role,"ADMIN"),eq(u.active,true),eq(u.totpEnrollmentRequired,false))});
 await db.transaction(async tx=>{
  for(const table of ["categories","product_types","audit_logs","outbox_events","outbox_deliveries"])await tx.execute(sql.raw(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`));
  await applyReferenceCatalog(tx,true);
  const input={productTypeKey:"POWER_TOOL",key:"INTAKE_"+createUuidV7().slice(-8).toUpperCase(),labelKa:"მიღების ქვეტიპი",labelEn:"Intake subtype"};
  await addProductSubtype(tx,{userId:admin!.id},input);await applyReferenceCatalog(tx,true);
  const [type]=await tx.select().from(productTypes).where(eq(productTypes.key,"POWER_TOOL")),field=type!.attributeSchemaJson.find(f=>f.key==="tool_kind")!;
  expect(field.enumValues).toContain(input.key);expect(field.enumValueMetadata?.[input.key]).toEqual({labelKa:input.labelKa,labelEn:input.labelEn,requiredSpecFields:[]});
  const next=mergeReferenceFields(type!.attributeSchemaJson,[{...field,enumValueMetadata:{[input.key]:{labelKa:input.labelKa,labelEn:input.labelEn,requiredSpecFields:["new_required_spec"]}}},{key:"new_required_spec",labelKa:"მახასიათებელი",labelEn:"Specification",dataType:"number",tier:"IMPORTANT_SPEC",filterCandidate:false}]);
  expect(next.find(f=>f.key==="tool_kind")!.enumValueMetadata?.[input.key]?.requiredSpecFields).toEqual(["new_required_spec"]);
  expect(next.some(f=>f.key==="cordless_battery")).toBe(true);expect(next.some(f=>f.key==="new_required_spec")).toBe(true);
  const approved=INITIAL_PRODUCT_TYPES.find(type=>type.key==="POWER_TOOL")!,previous=approved.attributeSchema;
  try {
   approved.attributeSchema=next;await applyReferenceCatalog(tx,true);
   const [updated]=await tx.select().from(productTypes).where(eq(productTypes.id,type!.id));
   expect(updated!.attributeSchemaJson.find(f=>f.key==="tool_kind")!.enumValueMetadata?.[input.key]?.requiredSpecFields).toEqual(["new_required_spec"]);
  }finally{approved.attributeSchema=previous;}
  await expect(addProductSubtype(tx,{userId:admin!.id},input)).rejects.toMatchObject({code:"CONFLICT"});
 });
});
it("preserves existing three vocabularies, records the approved subtype/spec matrix, and adds no compatibility model",()=>{
 for(const [key,fieldKey] of [["ACCESSORY","consumable_kind"],["POWER_TOOL","tool_kind"],["FARM_PROCESSOR","processor_kind"]])expect(INITIAL_PRODUCT_TYPES.find(t=>t.key===key)!.attributeSchema.find(f=>f.key===fieldKey)!.enumValues?.length).toBeGreaterThan(1);
 const spare=INITIAL_PRODUCT_TYPES.find(t=>t.key==="SPARE_PART")!.attributeSchema.find(f=>f.key==="part_subtype")!;
 expect(spare.enumValues).toEqual(["CHAIN","GUIDE_BAR","AIR_FILTER","SPARK_PLUG","BELT","TILLER_TINE"]);expect(spare.enumValueMetadata!.CHAIN!.requiredSpecFields).toEqual(["chain_pitch","gauge_mm","link_count"]);
 const consumable=INITIAL_PRODUCT_TYPES.find(t=>t.key==="CONSUMABLE")!;expect(consumable.aiResearchContract.repeatPurchase).toBe(true);
 expect(consumable.attributeSchema.find(f=>f.key==="consumable_subtype")!.enumValueMetadata!.WIRE_BRUSH!.requiredSpecFields).toContain("max_rpm");
 expect(INITIAL_PRODUCT_TYPES.find(t=>t.key==="GENERATOR")!.photoInstructions.filter(p=>p.slot.endsWith("IDENTIFICATION")&&p.required)).toHaveLength(2);
});
it("reference application requires an explicit matching target and never grants a production seed override",()=>{
 const env={DATABASE_URL:"postgres://hub_app:synthetic@127.0.0.1/catalog_test",NODE_ENV:"production"};
 expect(referenceCommand([],env)).toEqual({apply:false,database:"catalog_test"});
 expect(()=>referenceCommand(["--apply"],env)).toThrow(/SAFETY/);expect(()=>referenceCommand(["--apply","--expect-database=other"],env)).toThrow(/SAFETY/);
 expect(referenceCommand(["--apply","--expect-database=catalog_test"],env).apply).toBe(true);
 expect(()=>referenceCommand(["--force"],env)).toThrow();expect(()=>referenceCommand([],{DATABASE_URL:env.DATABASE_URL+"?host=elsewhere"})).toThrow(/SAFETY/);
});

import { expect,it } from "vitest";
import { sql } from "drizzle-orm";
import { users,userEntityMemberships } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { createUuidV7 } from "@khidi/shared";
import { inventoryFixture } from "../../inventory/src/test-fixture.ts";
import { auditHistory,inventoryHistory,redactAudit } from "./audit.ts";
it("redacts nested credentials and secret values before rendering while preserving IDs and ordinary before/after",async()=>{
 const f=await inventoryFixture(),id=createUuidV7(),apiId=createUuidV7();
 const before={quantity:1,password:"DoNotShow",nested:{totpSecret:"JBSWY3DPEHPK3PXP",apiKey:"sf_prefix_ABCDEFG",webhookSecret:"VerySecret"}};
 const after={quantity:2,actorApiKeyId:apiId,credentials:[{auth:"danger",p256dh:"sensitive"}],details:"Bearer raw-token",legalEntityId:f.entities[0]!.id};
 await withDomainTransaction(f.db,f.actor,async ctx=>{
  await ctx.recordAudit({action:"M10_AUDIT_FIXTURE",entityType:"fixture",entityId:id,before,after,reason:"Specific reason password=Secret"});
  await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"fixture",aggregateId:id,payload:{},consumers:[]});
 });
 const logs=await auditHistory(f.db,f.actor.userId,{action:"M10_AUDIT_FIXTURE",entityId:id,entityIdScope:f.entities[0]!.id,actorType:"USER",actorId:f.actor.userId});
 expect(logs.rows).toHaveLength(1);const row=logs.rows[0]!;
 expect(row.beforeJson).toMatchObject({quantity:1,password:"[REDACTED]"});expect(row.afterJson).toMatchObject({quantity:2,actorApiKeyId:apiId});
 expect(JSON.stringify(row)).not.toMatch(/DoNotShow|JBSWY3DPEHPK3PXP|sf_prefix_ABCDEFG|VerySecret|raw-token|password=Secret/);
 expect((await auditHistory(f.db,f.actor.userId,{action:"M10_AUDIT_FIXTURE",entityIdScope:f.entities[1]!.id})).rows).toHaveLength(0);
 expect(redactAudit({publicKey:"secret",metadata:{recoveryCodes:["123"]}})).toEqual({publicKey:"[REDACTED]",metadata:{recoveryCodes:"[REDACTED]"}});
});
it("paginates immutable audit entries and indexes legal scope without modifying original audit content",async()=>{
 const f=await inventoryFixture(false),correlationId="cor_"+createUuidV7();
 await withDomainTransaction(f.db,{...f.actor,correlationId},async ctx=>{
  for(let i=0;i<53;i++)await ctx.recordAudit({action:"M10_PAGE_FIXTURE",entityType:"fixture",entityId:String(i),after:{index:i,ownerEntityId:f.entities[0]!.id}});
  await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"fixture",aggregateId:createUuidV7(),payload:{},consumers:[]});
 });
 const first=await auditHistory(f.db,f.actor.userId,{correlationId,entityIdScope:f.entities[0]!.id}),next=await auditHistory(f.db,f.actor.userId,{correlationId,cursor:first.nextCursor!});
 expect(first.rows).toHaveLength(50);expect(next.rows).toHaveLength(3);expect(new Set([...first.rows,...next.rows].map(r=>r.id)).size).toBe(53);
 await expect(f.db.execute(sql`DELETE FROM audit_legal_entity_scopes WHERE audit_id=${first.rows[0]!.id}::uuid`)).rejects.toThrow();
});
it("stock managers see only own-entity ledger projections and cannot open the ADMIN audit",async()=>{
 const f=await inventoryFixture(),[manager,operator]=await f.db.insert(users).values(["STOCK_MANAGER","OPERATOR"].map(role=>({id:createUuidV7(),fullName:"History fixture",role}))).returning();
 await f.db.insert(userEntityMemberships).values({userId:manager!.id,legalEntityId:f.entities[0]!.id});
 await f.apply([{poolId:f.pools[1]!.id,skuId:f.sku.id,type:"STOCK_IN",quantity:7}]);
 const rows=await inventoryHistory(f.db,manager!.id);
 expect(rows.rows.length).toBeGreaterThan(0);expect(rows.rows.every(r=>r.ownerId===f.entities[0]!.id)).toBe(true);
 expect(JSON.stringify(rows)).not.toMatch(/sellerAccounting|ownerAccounting|password|actorApiKey/);
 await expect(inventoryHistory(f.db,manager!.id,{entityIdScope:f.entities[1]!.id})).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(auditHistory(f.db,manager!.id)).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(inventoryHistory(f.db,operator!.id)).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("filters service keys, background jobs and workflow policies as distinct actor types",async()=>{
 const f=await inventoryFixture(false),id=createUuidV7();
 for(const principalType of ["STOREFRONT_SERVICE","SYSTEM_JOB","SYSTEM_WORKFLOW"] as const){
  const principalId=principalType==="SYSTEM_WORKFLOW"?"SIMPLIFIED_FULFILLMENT":createUuidV7();
  await withDomainTransaction(f.db,{principalType,principalId},async ctx=>{
   await ctx.recordAudit({action:"M10_ACTOR_FIXTURE",entityType:"fixture",entityId:id,after:{legalEntityId:f.entities[0]!.id}});
   await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"fixture",aggregateId:id,payload:{},consumers:[]});
  });
  expect((await auditHistory(f.db,f.actor.userId,{actorType:principalType,actorId:principalId,action:"M10_ACTOR_FIXTURE",entityIdScope:f.entities[0]!.id})).rows).toHaveLength(1);
 }
});

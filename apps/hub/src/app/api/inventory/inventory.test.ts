import { expect, it, vi } from "vitest";
import { users } from "@khidi/db";
import { loadPrincipalByUserId, webauthnConfig, type AuthenticatedPrincipal } from "@khidi/auth";
import { configureAvailabilityPool } from "@khidi/inventory";
import { inventoryFixture } from "../../../../../../packages/inventory/src/test-fixture.ts";
import { createUuidV7 } from "@khidi/shared";
import { GET, POST } from "./route.ts";

const session=vi.hoisted(()=>({principal:null as AuthenticatedPrincipal|null}));
vi.mock("../../../lib/session.ts",()=>({getCurrentPrincipal:async()=>session.principal}));
it("authenticates stock reads/writes, previews without movements, requires a key and replays the confirmed absolute target",async()=>{
  const f=await inventoryFixture(false),origin=webauthnConfig().origin;
  const request=(action:string,input:unknown,key?:string)=>new Request(origin+"/api/inventory",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json",...(key?{"Idempotency-Key":key}:{})},body:JSON.stringify({action,input})});
  const target={skuId:f.sku.id,storefrontId:f.stores[0]!.id,target:10};
  session.principal=null;expect((await GET(new Request(origin+"/api/inventory"))).status).toBe(401);
  session.principal=await loadPrincipalByUserId(f.db,f.actor.userId);
  await configureAvailabilityPool(f.db,f.actor,{storefrontId:f.stores[0]!.id,poolId:f.base.poolId});
  expect((await POST(request("preview",target))).status).toBe(200);
  expect(await f.db.query.stockLedger.findMany({where:(r,{eq})=>eq(r.skuId,f.sku.id)})).toHaveLength(0);
  expect((await POST(request("set",target))).status).toBe(400);
  const key=createUuidV7(),first=await POST(request("set",target,key));
  expect(first.status).toBe(200);expect(await(await POST(request("set",target,key))).json()).toEqual(await first.json());
  expect(await f.db.query.stockLedger.findMany({where:(r,{eq})=>eq(r.skuId,f.sku.id)})).toHaveLength(2);
  for(const role of ["WAREHOUSE","OPERATOR","STOCK_MANAGER"]) {
    const [user]=await f.db.insert(users).values({id:createUuidV7(),fullName:"Inventory API fixture",role}).returning();
    session.principal=await loadPrincipalByUserId(f.db,user!.id);
    const denied=await GET(new Request(origin+`/api/inventory?storefrontId=${f.stores[0]!.id}`));
    expect(denied.status).toBe(403);expect(await denied.json()).not.toHaveProperty("rows");
    expect((await POST(request("create-pool",{ownerEntityId:f.entities[0]!.id,name:"Forbidden"},createUuidV7()))).status).toBe(403);
  }
});

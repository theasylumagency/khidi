import { afterEach, expect, it, vi } from "vitest";
import { createUuidV7 } from "@khidi/shared";
import { manageStorefrontServiceKey } from "@khidi/auth";
import { setFulfillmentMode } from "@khidi/reservations";
import { reservationFixture } from "../../../../packages/reservations/src/reservation.test-fixture.ts";
import { serviceAdminFixture } from "../../../../packages/auth/src/storefront-service.test-fixture.ts";
import { GET, POST } from "../app/api/v1/storefront/[store]/[...resource]/route.ts";
import { storefrontOpenApi } from "./storefront-contracts.ts";
afterEach(()=>vi.unstubAllEnvs());
async function apiFixture() {
  vi.stubEnv("KHIDI_API_HOST","api.example.test");
  const f=await reservationFixture(),p=await serviceAdminFixture(f.db),key=await manageStorefrontServiceKey(f.db,p,createUuidV7(),{action:"ISSUE",storefrontId:f.store.id,name:"HTTP fixture"});
  await setFulfillmentMode(f.db,{type:"USER",userId:p.userId},createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
  async function call(path:string,body?:unknown,options:{host?:string;store?:string;idempotencyKey?:string;authorization?:string;headers?:Record<string,string>}={}) {
    const resource=path.split("/"),store=options.store??f.store.key,request=new Request("http://"+(options.host??"api.example.test")+"/api/v1/storefront/"+store+"/"+path,
      {method:body===undefined ? "GET" : "POST",headers:{authorization:options.authorization??"Bearer "+key.body.rawApiKey!,...(body===undefined ? {} : {"content-type":"application/json","idempotency-key":options.idempotencyKey??createUuidV7()}),...options.headers},...(body===undefined ? {} : {body:JSON.stringify(body)})});
    return (body===undefined ? GET : POST)(request,{params:Promise.resolve({store,resource})});
  }return {...f,call,rawKey:key.body.rawApiKey!};
}
it("isolates host and scope, ignores forwarded-host/IP spoofing and serves only safe own-store projections",async()=>{
  const f=await apiFixture();
  expect((await f.call("products",undefined,{host:"app.example.test",headers:{"x-forwarded-host":"api.example.test"}})).status).toBe(404);
  expect((await f.call("products",undefined,{authorization:"Bearer bad"})).status).toBe(401);
  expect((await f.call("products",undefined,{store:f.stores[1]!.key})).status).toBe(403);
  expect((await f.call("products",undefined,{headers:{origin:"https://evil.example"}})).status).toBe(403);
  const response=await f.call("products"),body=await response.json();expect(response.status).toBe(200);
  expect(body.items).toContainEqual(expect.objectContaining({skuId:f.sku.id,available_to_sell:60}));
  expect(JSON.stringify(body)).not.toMatch(/KH-\d|accounting|supplier|app\.khidi|raw\/|master\//i);
  expect(response.headers.has("access-control-allow-origin")).toBe(false);
});
it("confirms atomically through HTTP, replays the whole call and keeps bundles and customer fields private",async()=>{
  const f=await apiFixture(),bundle=await f.bundle(),key=createUuidV7(),input={storefrontOrderRef:"HTTP-1",paymentMethod:"CASH_ON_DELIVERY",items:[{skuId:bundle.sku.id,quantity:1}],
    confirmation:{deliveryMethod:"PICKUP",shipBy:"2030-01-01",prices:[{skuId:bundle.sku.id,finalUnitPriceMinor:10000,currency:"GEL"}]}};
  const r=await f.call("reservations",input,{idempotencyKey:key}),body=await r.json();expect(r.status).toBe(201);expect(body).toMatchObject({status:"HANDED_OVER",confirmation:"AUTO_ASSUMED"});
  expect(await (await f.call("reservations",input,{idempotencyKey:key})).json()).toEqual(body);
  expect((await f.db.query.stockLedger.findMany({where:(l,{eq})=>eq(l.reservationId,body.reservationId)})).filter((r)=>r.movementType==="HANDOVER_OUT")).toHaveLength(2);
  const full=await (await f.call("fulfillment-requests/"+body.fulfillmentRequestId)).json();expect(full.lines).toEqual([{skuId:bundle.sku.id,quantity:1,finalUnitPriceMinor:10000,currency:"GEL"}]);
  expect(JSON.stringify(full)).not.toMatch(/parentBundle|allocation|accounting|fulfillmentMode/);
  expect((await f.call("reservations",{...input,email:"private@example.test"})).status).toBe(400);
  expect((await f.call("reservations",{...input,storefrontOrderRef:"555123456"})).status).toBe(400);
  expect((await f.call("fulfillment-requests/"+body.fulfillmentRequestId+"/cancel",{reason:"Too late"})).status).toBe(409);
});
it("generates OpenAPI from the actual strict Zod shapes and documents both outcomes",()=>{
  const api=storefrontOpenApi(),text=JSON.stringify(api);expect(text).toContain("additionalProperties");expect(text).toContain("HANDED_OVER/AUTO_ASSUMED");expect(text).toContain("RESERVATION_EXPIRED");expect(text).toContain("Idempotency-Key");
  expect(Object.keys(api.paths)).toContain("/api/v1/storefront/{store}/reservations/{id}/commit");
});

import { createServer, type Server } from "node:http";
import { afterEach,expect,it,vi } from "vitest";
import { manageStorefrontServiceKey } from "@khidi/auth";
import { configureStorefrontWebhook,dispatchStorefrontWebhooks,sendWebhook } from "@khidi/publishing/webhooks";
import { setFulfillmentMode } from "@khidi/reservations";
import { createUuidV7 } from "@khidi/shared";
import { serviceAdminFixture } from "../../../../packages/auth/src/storefront-service.test-fixture.ts";
import { reservationFixture } from "../../../../packages/reservations/src/reservation.test-fixture.ts";
import { exerciseStorefrontFlow,TestStorefrontClient,verifyWebhookSignature } from "../../../../ops/storefront-test-client.ts";
import { GET,POST } from "../app/api/v1/storefront/[store]/[...resource]/route.ts";
const servers:Server[]=[];
afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(servers.splice(0).map(s=>new Promise<void>((resolve)=>s.close(()=>resolve()))));});
async function listen(server:Server){servers.push(server);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));return "http://127.0.0.1:"+(server.address() as import("node:net").AddressInfo).port;}
it("executes the test client over real HTTP through the Hub handler and a signed webhook receiver",async()=>{
  vi.stubEnv("KHIDI_API_HOST","api.example.test");const f=await reservationFixture(),admin=await serviceAdminFixture(f.db);
  await setFulfillmentMode(f.db,{type:"USER",userId:admin.userId},createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
  const issued=await manageStorefrontServiceKey(f.db,admin,createUuidV7(),{action:"ISSUE",storefrontId:f.store.id,name:"Client fixture"});
  const base=await listen(createServer(async(req,res)=>{
    try{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(","):v);
      const request=new Request("http://"+req.headers.host+req.url,{method:req.method,headers,...(req.method==="POST"?{body:Buffer.concat(chunks)}:{})});
      const parts=new URL(request.url).pathname.split("/").slice(4),params={params:Promise.resolve({store:parts[0]!,resource:parts.slice(1)})};
      const response=await(req.method==="POST"?POST:GET)(request,params);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
    }catch{res.writeHead(500);res.end("{}");}
  }));
  const client=new TestStorefrontClient(base,"api.example.test",f.store.key,issued.body.rawApiKey!);
  const completed=await exerciseStorefrontFlow(client,f.sku.id);
  const events:Record<string,any>[]=[];let secret="";
  const receiver=await listen(createServer(async(req,res)=>{let text="";for await(const chunk of req)text+=chunk;const valid=verifyWebhookSignature(secret,String(req.headers["x-khidi-timestamp"]),text,String(req.headers["x-khidi-signature"]));if(valid)events.push(JSON.parse(text));res.writeHead(valid?204:401);res.end();}));
  secret=(await configureStorefrontWebhook(f.db,admin,createUuidV7(),{storefrontId:f.store.id,url:receiver+"/hook"})).body.secret!;
  const final=await f.db.query.outboxEvents.findMany({where:(e,{and,eq})=>and(eq(e.aggregateId,completed.fulfillmentRequestId),eq(e.eventType,"FULFILLMENT_STATUS_CHANGED"))});
  for(const event of final){const d=await f.db.query.outboxDeliveries.findFirst({where:(d,{and,eq})=>and(eq(d.outboxEventId,event.id),eq(d.consumer,"storefront:"+f.store.id))});if(d)await dispatchStorefrontWebhooks(f.db,{onlyDeliveryId:d.id,transport:sendWebhook});}
  expect(events).toContainEqual(expect.objectContaining({schemaVersion:1,data:expect.objectContaining({status:"HANDED_OVER",confirmation:"AUTO_ASSUMED"})}));
  expect((await f.db.query.stockLedger.findMany({where:(l,{eq})=>eq(l.reservationId,completed.reservationId)})).filter(r=>r.movementType==="HANDOVER_OUT")).toHaveLength(1);
  expect((await client.call("products",undefined,undefined,{host:"app.example.test"})).status).toBe(404);
  expect((await client.call("products",undefined,undefined,{store:f.stores[1]!.key})).status).toBe(403);
  expect((await client.call("reservations",{})).status).toBe(400);
  const rotated=await manageStorefrontServiceKey(f.db,admin,createUuidV7(),{action:"ROTATE",keyId:issued.body.id,name:"Client fixture",rateLimitPerMinute:1});
  expect((await client.call("products")).status).toBe(401);
  const constrained=new TestStorefrontClient(base,"api.example.test",f.store.key,rotated.body.rawApiKey!);
  expect((await constrained.call("products")).status).toBe(200);
  const limited=await constrained.call("products");expect(limited.status).toBe(429);expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
});

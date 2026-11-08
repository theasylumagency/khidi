import { createServer, get } from "node:http";
import { assertTestDatabaseSafety } from "../packages/db/src/test-database-safety.ts";
import { closeAppPool } from "../packages/db/src/client.ts";
import { reservationFixture } from "../packages/reservations/src/reservation.test-fixture.ts";
import { serviceAdminFixture } from "../packages/auth/src/storefront-service.test-fixture.ts";
import { manageStorefrontServiceKey } from "../packages/auth/src/storefront-service.ts";
import { setFulfillmentMode } from "../packages/reservations/src/mode.ts";
import { configureStorefrontWebhook, dispatchStorefrontWebhooks } from "../packages/publishing/src/webhooks.ts";
import { createUuidV7 } from "../packages/shared/src/uuid.ts";
import { exerciseStorefrontFlow, TestStorefrontClient, verifyWebhookSignature } from "./storefront-test-client.ts";

assertTestDatabaseSafety();
for(const name of ["DATABASE_URL","DATABASE_MIGRATOR_URL"] as const)if(!["localhost","127.0.0.1","[::1]"].includes(new URL(process.env[name]!).hostname))throw new Error("SAFETY: local smoke requires loopback test databases.");
const base=process.env.KHIDI_TEST_API_URL??"http://127.0.0.1:3123",host=process.env.KHIDI_API_HOST??"api.localhost:3123";
const received:Record<string,any>[]=[],seen=new Set<string>();let secret="";
const receiver=createServer(async(req,res)=>{let body="";for await(const chunk of req){body+=chunk;if(body.length>2000000){res.writeHead(413);res.end();return;}}
  if(!verifyWebhookSignature(secret,String(req.headers["x-khidi-timestamp"]),body,String(req.headers["x-khidi-signature"]))){res.writeHead(401);res.end();return;}
  const event=JSON.parse(body);if(!seen.has(event.id)){seen.add(event.id);received.push(event);}res.writeHead(204);res.end();
});
try {
  await new Promise<void>(r=>receiver.listen(0,"127.0.0.1",r));
  const f=await reservationFixture(),admin=await serviceAdminFixture(f.db);
  await setFulfillmentMode(f.db,{type:"USER",userId:admin.userId},createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
  const key=await manageStorefrontServiceKey(f.db,admin,createUuidV7(),{action:"ISSUE",storefrontId:f.store.id,name:"Local HTTP smoke"});
  secret=(await configureStorefrontWebhook(f.db,admin,createUuidV7(),{storefrontId:f.store.id,url:"http://127.0.0.1:"+(receiver.address() as import("node:net").AddressInfo).port+"/events"})).body.secret!;
  const client=new TestStorefrontClient(base,host,f.store.key,key.body.rawApiKey!),flow=await exerciseStorefrontFlow(client,f.sku.id);
  const events=await f.db.query.outboxEvents.findMany({where:(e,{eq})=>eq(e.aggregateId,flow.fulfillmentRequestId)});
  for(const event of events){const d=await f.db.query.outboxDeliveries.findFirst({where:(d,{and,eq})=>and(eq(d.outboxEventId,event.id),eq(d.consumer,"storefront:"+f.store.id))});if(d)await dispatchStorefrontWebhooks(f.db,{onlyDeliveryId:d.id});}
  if(!received.some(e=>e.data.status==="HANDED_OVER"&&e.data.confirmation==="AUTO_ASSUMED"))throw new Error("Signed final webhook missing.");
  if((await client.call("products",undefined,undefined,{host:new URL(base).host})).status!==404)throw new Error("Admin host isolation failed.");
  const loginStatus=await new Promise<number>((resolve,reject)=>{const request=get(base+"/login",{headers:{host}},response=>{response.resume();response.on("end",()=>resolve(response.statusCode??0));});request.on("error",reject);});
  if(loginStatus!==404)throw new Error("API host exposed login.");
  console.log(JSON.stringify({passed:true,transport:"Next.js HTTP",flow:"reserve → payment → automatic fulfillment → signed webhook",webhooks:received.length}));
}finally{await new Promise<void>(r=>receiver.close(()=>r()));await closeAppPool();}

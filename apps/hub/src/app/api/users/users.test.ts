import { afterEach,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
import { getDb,legalEntities,sessions,userSetupLinks } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import { serviceAdminSessionFixture } from "../../../../../../packages/auth/src/storefront-service.test-fixture.ts";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { createUserCommandSender } from "../../../lib/user-management-client.ts";
const state=vi.hoisted(()=>({principal:null as AuthenticatedPrincipal|null}));
vi.mock("../../../lib/session.ts",()=>({getCurrentPrincipal:async()=>state.principal,KHIDI_DEVICE_COOKIE:"khidi_device_token"}));
import { POST as manage } from "./route.ts";
import { POST as setup } from "../auth/setup/route.ts";
const request=(path:string,body:unknown,origin="http://localhost:3100")=>new NextRequest("http://localhost:3100/api/"+path,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json","Idempotency-Key":createUuidV7()},body:JSON.stringify(body)});
afterEach(()=>{state.principal=null;vi.useRealTimers();});
it.each(["headers","body"])("retries a creation response lost at %s without duplicating a warehouse account or recovering its raw link",async(loss)=>{
 const db=getDb(),auth=await serviceAdminSessionFixture(db),[entity]=await db.select().from(legalEntities).limit(1);state.principal=auth.principal;
 const name="Lost-response-"+createUuidV7();let first=true;
 const send=createUserCommandSender(async(_url,init)=>{
  const headers=new Headers(init?.headers);headers.set("Origin","http://localhost:3100");
  const response=await manage(new Request("http://localhost:3100/api/users",{...init,headers}));
  if(first){first=false;expect(response.status).toBe(201);if(loss==="body")return new Response('{"id":',{status:201});throw new Error("Synthetic response loss after commit");}return response;
 });
 const input={action:"CREATE",fullName:name,email:null,role:"WAREHOUSE",entityIds:[entity!.id],permissions:[]};
 await expect(send(input)).rejects.toThrow();const {response,body}=await send(input);expect(response.status).toBe(201);expect(body.setupUrl).toBeUndefined();
 expect(await db.query.users.findMany({where:(u,{eq})=>eq(u.fullName,name)})).toHaveLength(1);
});
it("requires ADMIN, same-origin JSON and recent strong proof for user writes",async()=>{
 expect((await manage(request("users",{}))).status).toBe(401);
 const db=getDb(),auth=await serviceAdminSessionFixture(db);state.principal={...auth.principal,role:"STOCK_MANAGER"};expect((await manage(request("users",{}))).status).toBe(403);
 state.principal=auth.principal;expect((await manage(request("users",{},"https://foreign.invalid"))).status).toBe(403);
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+601000);
 expect((await manage(request("users",{action:"TTL",hours:72}))).status).toBe(428);
});
it("hands out only a fragment token, completes single-use setup without issuing a session, and never exposes token errors",async()=>{
 const db=getDb(),auth=await serviceAdminSessionFixture(db),[entity]=await db.select().from(legalEntities).limit(1);state.principal=auth.principal;
 const response=await manage(request("users",{action:"CREATE",fullName:"HTTP setup",email:`http-${createUuidV7()}@example.test`,role:"OPERATOR",entityIds:[entity!.id],permissions:[]}));
 expect(response.status).toBe(201);expect(response.headers.get("Cache-Control")).toContain("no-store");const body=await response.json(),url=new URL(body.setupUrl),token=url.hash.slice(7);expect(url.search).toBe("?setup=1");
 expect((await setup(request("auth/setup",{action:"INSPECT",token}))).status).toBe(403);state.principal=null;
 expect((await setup(request("auth/setup",{action:"INSPECT",token}))).status).toBe(200);
 const done=await setup(request("auth/setup",{action:"COMPLETE",token,secret:"Synthetic HTTP password #2026"}));expect(done.status).toBe(200);expect(done.headers.has("Set-Cookie")).toBe(false);
 expect(await db.query.sessions.findMany({where:(s,{eq})=>eq(s.userId,body.id)})).toHaveLength(0);
 const reused=await setup(request("auth/setup",{action:"INSPECT",token})),unknown=await setup(request("auth/setup",{action:"INSPECT",token:"x".repeat(43)}));expect(reused.status).toBe(401);expect(await reused.json()).toEqual(await unknown.json());
 expect((await setup(request("auth/setup",{action:"INSPECT",token},"https://foreign.invalid"))).status).toBe(403);
 expect((await db.query.userSetupLinks.findMany({where:(s,{eq})=>eq(s.userId,body.id)}))[0]!.usedAt).toBeTruthy();
});

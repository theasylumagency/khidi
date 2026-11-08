import { beforeEach,expect,it,vi } from "vitest";
const receive=vi.hoisted(()=>vi.fn());
vi.mock("@khidi/scanning",()=>({receiveIntake:receive}));
vi.mock("@khidi/db",()=>({getDb:()=>({})}));
vi.mock("@khidi/auth",()=>({assertRoleAllowed:()=>{}}));
vi.mock("../../../../lib/session.ts",()=>({getCurrentPrincipal:async()=>({userId:"fixture",role:"WAREHOUSE"})}));
import { POST } from "./route.ts";
beforeEach(()=>receive.mockReset());
const headers={"Content-Type":"application/json",Origin:"http://localhost:3100"};
it("rejects a declared oversized request before intake mutation",async()=>{
 const r=await POST(new Request("http://localhost:3100/api/scanning/intakes",{method:"POST",headers:{...headers,"Content-Length":"1048577"},body:"{}"}));
 expect(r.status).toBe(413);expect(receive).not.toHaveBeenCalled();
});
it("bounds a chunked body and oversized collection before domain validation",async()=>{
 const request=new Request("http://localhost:3100/api/scanning/intakes",{method:"POST",headers,duplex:"half",
  body:new ReadableStream({start(c){c.enqueue(new Uint8Array(600000));c.enqueue(new Uint8Array(600000));c.close();}})} as RequestInit);
 expect((await POST(request)).status).toBe(413);
 expect((await POST(new Request("http://localhost:3100/api/scanning/intakes",{method:"POST",headers,body:JSON.stringify({photos:Array(1001).fill({})})}))).status).toBe(413);
 expect(receive).not.toHaveBeenCalled();
});

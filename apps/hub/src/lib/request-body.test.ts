import { expect,it } from "vitest";
import { readBoundedJson,readBoundedText } from "./request-body.ts";
it("refuses missing/foreign origins and browser cross-site writes before parsing",async()=>{
 for(const headers of ([{},{Origin:"https://other.example"},{Origin:"http://localhost:3100","Sec-Fetch-Site":"cross-site"}] as Record<string,string>[])) {
  await expect(readBoundedJson(new Request("http://localhost:3100/api/products/skus",{method:"POST",headers,body:"{}"}))).rejects.toMatchObject({code:"FORBIDDEN"});
 }
 await expect(readBoundedText(new Request("http://localhost:3100/api/prices/csv",{method:"POST",body:"x"}))).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("requires JSON MIME and bounded bytes even for a valid browser origin",async()=>{
 const request=(headers:Record<string,string>,body="{}")=>new Request("http://localhost:3100/api/products/skus",{method:"POST",headers:{Origin:"http://localhost:3100",...headers},body});
 await expect(readBoundedJson(request({}))).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(readBoundedJson(request({"Content-Type":"application/json"}),1)).rejects.toMatchObject({code:"PAYLOAD_TOO_LARGE"});
 await expect(readBoundedJson(request({"Content-Type":"application/json"}))).resolves.toEqual({});
});

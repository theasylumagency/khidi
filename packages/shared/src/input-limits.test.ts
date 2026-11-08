import { expect,it } from "vitest";
import { z } from "zod";
import { assertJsonBounds,boundedRecord,parseBoundedJson,readBoundedBytes,readBoundedJson,readBoundedForm } from "./input-limits.ts";
it("bounds a chunked stream by actual bytes before JSON parsing, independent of Content-Length",async()=>{
 let cancelled=false;
 const request=new Request("https://app.example.test",{method:"POST",duplex:"half",body:new ReadableStream({
  start(c){c.enqueue(new Uint8Array(8));c.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}
 })} as RequestInit);
 await expect(readBoundedBytes(request,10)).rejects.toMatchObject({code:"PAYLOAD_TOO_LARGE"});expect(cancelled).toBe(true);
});
it("rejects declared oversize, compressed and malformed bodies, and accepts a bounded valid JSON request",async()=>{
 await expect(readBoundedJson(new Request("https://app.example.test",{method:"POST",headers:{"Content-Length":"100"},body:"{}"}),10)).rejects.toMatchObject({code:"PAYLOAD_TOO_LARGE"});
 await expect(readBoundedJson(new Request("https://app.example.test",{method:"POST",headers:{"Content-Encoding":"gzip"},body:"{}"}))).rejects.toMatchObject({code:"VALIDATION_ERROR"});
 await expect(readBoundedJson(new Request("https://app.example.test",{method:"POST",body:"{"}))).rejects.toMatchObject({code:"VALIDATION_ERROR"});
 await expect(readBoundedJson(new Request("https://app.example.test",{method:"POST",body:'{"quantity":2}'}))).resolves.toEqual({quantity:2});
});
it("caps collection shape and depth before constrained element validation can allocate unbounded issues",()=>{
 expect(()=>parseBoundedJson(JSON.stringify(Array.from({length:1001},()=>({bad:true}))))).toThrow();
 let nested:unknown=null;for(let i=0;i<22;i++)nested={child:nested};expect(()=>assertJsonBounds(nested)).toThrow();
 let validations=0;const schema=boundedRecord(z.string().max(20),z.preprocess(v=>{validations++;return v;},z.number()),2);
 expect(schema.safeParse({a:"bad",b:"bad",c:"bad"}).success).toBe(false);expect(validations).toBe(0);
 expect(schema.parse({a:1,b:2})).toEqual({a:1,b:2});
});
it("bounds multipart bytes before form parsing and preserves accepted file bytes",async()=>{
 const form=new FormData();form.set("metadata",'{"slot":"MAIN"}');form.set("file",new File([new Uint8Array([0,255,1])],"photo.jpg",{type:"image/jpeg"}));
 const encoded=new Response(form),type=encoded.headers.get("content-type")!,bytes=await encoded.arrayBuffer();
 const request=new Request("https://app.example.test",{method:"POST",headers:{"Content-Type":type},body:bytes});
 const data=await readBoundedForm(request,4096);expect([...new Uint8Array(await (data.get("file") as File).arrayBuffer())]).toEqual([0,255,1]);
 await expect(readBoundedForm(new Request("https://app.example.test",{method:"POST",headers:{"Content-Type":type},body:bytes}),10)).rejects.toMatchObject({code:"PAYLOAD_TOO_LARGE"});
});

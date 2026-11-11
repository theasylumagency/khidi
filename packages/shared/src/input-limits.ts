import { z } from "zod";
import { AppError } from "./errors.ts";

export const JSON_BODY_BYTES=1024*1024;
export const CSV_BODY_BYTES=8*1024*1024;
export const MULTIPART_BODY_BYTES=18*1024*1024;
export const INPUT_LIMITS={depth:20,nodes:20_000,array:1000,record:1000,string:2_000_000} as const;
const tooLarge=()=>new AppError("PAYLOAD_TOO_LARGE","Request exceeds its input limit.");

/** Reject oversized records before Zod can allocate one issue for every value. */
export function boundedRecord<K extends z.KeySchema,V extends z.ZodTypeAny>(key:K,value:V,maxEntries:number) {
 const record=z.record(key,value);
 return z.custom<z.input<typeof record>>().superRefine((input,ctx)=>{
  if(input&&typeof input==="object"&&!Array.isArray(input)&&Object.keys(input).length>maxEntries)
   ctx.addIssue({code:"custom",message:"Too many record entries.",fatal:true});
 }).pipe(record);
}

/** Iterative preflight runs before schema validation; it never builds an issue tree. */
export function assertJsonBounds(value:unknown) {
 const pending:[unknown,number][]=[[value,0]];let nodes=0;
 while(pending.length) {
  const [node,depth]=pending.pop()!;
  if(++nodes>INPUT_LIMITS.nodes||depth>INPUT_LIMITS.depth)throw tooLarge();
  if(typeof node==="string"&&node.length>INPUT_LIMITS.string)throw tooLarge();
  if(!node||typeof node!=="object")continue;
  const values=Array.isArray(node)?node:Object.values(node);
  if(values.length>(Array.isArray(node)?INPUT_LIMITS.array:INPUT_LIMITS.record))throw tooLarge();
  if(!Array.isArray(node)&&Object.keys(node).some(k=>k.length>256))throw tooLarge();
  if(pending.length+values.length+nodes>INPUT_LIMITS.nodes)throw tooLarge();
  for(const item of values)pending.push([item,depth+1]);
 }
}
export function parseBoundedJson(text:string):unknown {
 let value:unknown;
 try{value=JSON.parse(text);}catch{throw new AppError("VALIDATION_ERROR","Invalid JSON body.");}
 assertJsonBounds(value);return value;
}
export function parseBoundedObjectJson(text:string):Record<string,unknown> {
 const value=parseBoundedJson(text);
 if(!value||typeof value!=="object"||Array.isArray(value))throw new AppError("VALIDATION_ERROR","A JSON object is required.");
 return value as Record<string,unknown>;
}

/** Count actual streamed bytes, including chunked requests, before buffering/parsing. */
export async function readBoundedBytes(request:Request,maxBytes=JSON_BODY_BYTES):Promise<Uint8Array> {
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new Error("Invalid body limit.");
 const length=request.headers.get("content-length");
 if(length!==null&&(!/^\d{1,12}$/.test(length)||Number(length)>maxBytes))throw tooLarge();
 const encoding=request.headers.get("content-encoding");
 if(encoding&&encoding.toLowerCase()!=="identity")throw new AppError("VALIDATION_ERROR","Compressed request bodies are not supported.");
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();
 let bytes=new Uint8Array(Math.min(65536,maxBytes)),size=0;
 try{
  for(;;) {
   const part=await reader.read();if(part.done)break;
   if(part.value.byteLength>maxBytes-size){await reader.cancel().catch(()=>{});throw tooLarge();}
   const next=size+part.value.byteLength;
   if(next>bytes.byteLength){const grown=new Uint8Array(Math.min(maxBytes,Math.max(next,bytes.byteLength*2)));grown.set(bytes);bytes=grown;}
   bytes.set(part.value,size);size=next;
  }
  return bytes.slice(0,size);
 }finally{reader.releaseLock();}
}
export async function readBoundedText(request:Request,maxBytes=JSON_BODY_BYTES) {
 const bytes=await readBoundedBytes(request,maxBytes);
 try{return new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw new AppError("VALIDATION_ERROR","Invalid UTF-8 body.");}
}
export async function readBoundedJson(request:Request,maxBytes=JSON_BODY_BYTES):Promise<Record<string,unknown>> {
 return parseBoundedObjectJson(await readBoundedText(request,maxBytes));
}
export async function readBoundedForm(request:Request,maxBytes=MULTIPART_BODY_BYTES) {
 const bytes=await readBoundedBytes(request,maxBytes);
 return new Response(bytes.slice().buffer,{headers:request.headers}).formData();
}

import { createUuidV7 } from "@khidi/shared/uuid";
/** Keep the intent until a complete successful response; no duplicate writes after response loss. */
export function adminSetupSender(endpoint:string) {
 let pending:{body:string;key:string}|undefined;
 return async(input:unknown)=>{
  const body=JSON.stringify(input);if(pending?.body!==body)pending={body,key:createUuidV7()};
  const response=await fetch(endpoint,{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",headers:{"Content-Type":"application/json","Idempotency-Key":pending!.key},body});
  const result=await response.json() as {error?:string};if(response.ok)pending=undefined;
  return {response,body:result};
 };
}

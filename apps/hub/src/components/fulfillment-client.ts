import { t } from "@khidi/i18n";
export class FulfillmentActionError extends Error {constructor(message:string,public code?:string){super(message);}}
export async function fulfillmentPost(url:string,input:unknown,key:string) {
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(input)});
  const body=await r.json();if(!r.ok)throw new FulfillmentActionError(body.error??t("scanning.error"),body.code);return body as Record<string,unknown>;
}

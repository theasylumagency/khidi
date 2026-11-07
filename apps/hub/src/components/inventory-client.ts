import { t } from "@khidi/i18n";
export async function inventoryPost(action:string,input:unknown,key?:string) {
  const response=await fetch("/api/inventory",{method:"POST",headers:{"Content-Type":"application/json",...(key?{"Idempotency-Key":key}:{})},body:JSON.stringify({action,input})});
  const body=await response.json();
  if(!response.ok) {
    const error=new Error(body.error??t("scanning.error")) as Error & {blockedAllocations?:{allocationId:string;reserved:number;committed:number}[]};
    error.blockedAllocations=body.blockedAllocations;throw error;
  }
  return body;
}

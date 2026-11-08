import { createHmac, timingSafeEqual } from "node:crypto";
export function webhookSignature(secret:string,timestamp:string,body:string) {
  return "v1="+createHmac("sha256",secret).update(timestamp+"."+body).digest("hex");
}
/** Verify exact bytes before parsing JSON. Receivers also deduplicate the event id. */
export function verifyWebhookSignature(secret:string,timestamp:string,body:string,signature:string,now=Date.now()) {
  if(!/^\d{10,11}$/.test(timestamp) || Math.abs(now-Number(timestamp)*1000)>300000 || !/^v1=[a-f0-9]{64}$/.test(signature))return false;
  return timingSafeEqual(Buffer.from(signature),Buffer.from(webhookSignature(secret,timestamp,body)));
}

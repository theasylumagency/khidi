import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import webPush from "web-push";
import { vapidConfig } from "./push-config.ts";
export type BrowserPushSubscription={endpoint:string;expirationTime?:number|null;keys:{p256dh:string;auth:string}};
export type PushTransport=(subscription:BrowserPushSubscription,payload:string)=>Promise<number>;
function publicAddress(ip:string){
 if(isIP(ip)===6)return /^[23][0-9a-f]{3}:/i.test(ip);
 if(isIP(ip)!==4)return false;const parts=ip.split(".").map(Number),a=parts[0]!,b=parts[1]!;
 return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168)&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19));
}
/** web-push encrypts/signs; the bounded transport pins public DNS and never follows redirects. */
export const sendWebPush:PushTransport=async(subscription,payload)=>{
 const url=new URL(subscription.endpoint);if(url.protocol!=="https:"||url.username||url.password||url.hash)throw new Error("PUSH_ENDPOINT_REFUSED");
 const started=Date.now();let dnsTimer:ReturnType<typeof setTimeout>|undefined;
 const addresses=await Promise.race([lookup(url.hostname.replace(/^\[|\]$/g,""),{all:true}),new Promise<never>((_r,reject)=>{dnsTimer=setTimeout(()=>reject(new Error("PUSH_DNS_TIMEOUT")),5000);})]).finally(()=>clearTimeout(dnsTimer));
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error("PUSH_ENDPOINT_REFUSED");
 const address=addresses.find(a=>a.family===4)??addresses[0]!,vapid=vapidConfig();
 const details=webPush.generateRequestDetails(subscription,payload,{vapidDetails:vapid,TTL:300,contentEncoding:"aes128gcm"});
 return new Promise<number>((resolve,reject)=>{
  const req=request(url,{method:"POST",headers:details.headers,lookup:(_h,options,cb)=>options.all?cb(null,[address]):cb(null,address.address,address.family)},res=>{
   let bytes=0;res.on("data",chunk=>{bytes+=chunk.length;if(bytes>65536)req.destroy(new Error("PUSH_RESPONSE_TOO_LARGE"));});res.on("end",()=>{clearTimeout(timer);resolve(res.statusCode??0);});
  });const timer=setTimeout(()=>req.destroy(new Error("PUSH_TIMEOUT")),Math.max(1,5000-(Date.now()-started)));
  req.on("error",()=>{clearTimeout(timer);reject(new Error("PUSH_TRANSPORT_ERROR"));});req.end(details.body);
 });
};

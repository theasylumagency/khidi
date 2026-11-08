import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
import { AppError } from "@khidi/shared";
export type WebhookTransport=(url:string,body:string,headers:Record<string,string>)=>Promise<{status:number;durationMs:number}>;
export function webhookUrl(raw:string,production=process.env.NODE_ENV==="production") {
  let url:URL;try{url=new URL(raw);}catch{throw new AppError("VALIDATION_ERROR","Invalid webhook URL.");}
  if(url.username || url.password || url.hash || (url.protocol!=="https:" && !(url.protocol==="http:" && !production && ["localhost","127.0.0.1","[::1]"].includes(url.hostname))))throw new AppError("VALIDATION_ERROR","HTTPS webhook URL required.");
  if(/(^|\.)khidi\.app$/i.test(url.hostname))throw new AppError("VALIDATION_ERROR","Webhook must target the storefront.");
  return url;
}
function publicIp(address:string) {
  if(isIP(address)===6)return /^[23][0-9a-f]{3}:/i.test(address); // Global unicast; excludes mapped/private/link-local addresses.
  if(isIP(address)!==4)return false;
  const parts=address.split(".").map(Number),a=parts[0]!,b=parts[1]!;
  return a!==0 && a!==10 && a!==127 && a<224 && !(a===169&&b===254) && !(a===172&&b>=16&&b<=31) && !(a===192&&b===168) && !(a===100&&b>=64&&b<=127) && !(a===198&&(b===18||b===19));
}
/** Resolve once and pin the address. Never follow redirects or store response bodies. */
export const sendWebhook:WebhookTransport=async(raw,body,headers)=>{
  const url=webhookUrl(raw),addresses=await lookup(url.hostname.replace(/^\[|\]$/g,""),{all:true});
  const local=process.env.NODE_ENV!=="production" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname);
  if(!addresses.length || (!local && addresses.some((r)=>!publicIp(r.address))))throw new Error("WEBHOOK_DESTINATION_REFUSED");
  const address=addresses.find((r)=>r.family===4)??addresses[0]!,started=Date.now();
  return new Promise((resolve,reject)=>{
    const req=(url.protocol==="https:" ? httpsRequest : httpRequest)(url,{method:"POST",headers:{...headers,"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)},
      lookup:(_hostname,options,callback)=>options.all ? callback(null,[address]) : callback(null,address.address,address.family)},(res)=>{
      res.resume();res.on("end",()=>{clearTimeout(timer);resolve({status:res.statusCode??0,durationMs:Date.now()-started});});
    });
    const timer=setTimeout(()=>req.destroy(new Error("WEBHOOK_TIMEOUT")),5000);
    req.on("error",()=>{clearTimeout(timer);reject(new Error("WEBHOOK_NETWORK_ERROR"));});req.end(body);
  });
};

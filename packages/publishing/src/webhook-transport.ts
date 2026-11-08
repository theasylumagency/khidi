import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { isPublicNetworkAddress } from "@khidi/shared/public-address";
import { AppError } from "@khidi/shared";
export type WebhookTransport=(url:string,body:string,headers:Record<string,string>)=>Promise<{status:number;durationMs:number}>;
export function webhookUrl(raw:string,production=process.env.NODE_ENV==="production") {
  let url:URL;try{url=new URL(raw);}catch{throw new AppError("VALIDATION_ERROR","Invalid webhook URL.");}
  if(url.username || url.password || url.hash || (url.protocol!=="https:" && !(url.protocol==="http:" && !production && ["localhost","127.0.0.1","[::1]"].includes(url.hostname))))throw new AppError("VALIDATION_ERROR","HTTPS webhook URL required.");
  if(/(^|\.)khidi\.app$/i.test(url.hostname))throw new AppError("VALIDATION_ERROR","Webhook must target the storefront.");
  return url;
}
/** Resolve once and pin the address. Never follow redirects or store response bodies. */
export const sendWebhook:WebhookTransport=async(raw,body,headers)=>{
  const url=webhookUrl(raw),started=Date.now();let dnsTimer:ReturnType<typeof setTimeout>|undefined;
  const addresses=await Promise.race([lookup(url.hostname.replace(/^\[|\]$/g,""),{all:true}),
    new Promise<never>((_r,reject)=>{dnsTimer=setTimeout(()=>reject(new Error("WEBHOOK_DNS_TIMEOUT")),5000);})]).finally(()=>clearTimeout(dnsTimer));
  const local=process.env.NODE_ENV!=="production" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname);
  if(!addresses.length || (!local && addresses.some((r)=>!isPublicNetworkAddress(r.address))))throw new Error("WEBHOOK_DESTINATION_REFUSED");
  const address=addresses.find((r)=>r.family===4)??addresses[0]!;
  return new Promise((resolve,reject)=>{
    const req=(url.protocol==="https:" ? httpsRequest : httpRequest)(url,{method:"POST",headers:{...headers,"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)},
      lookup:(_hostname,options,callback)=>options.all ? callback(null,[address]) : callback(null,address.address,address.family)},(res)=>{
      let bytes=0;res.on("data",chunk=>{bytes+=chunk.length;if(bytes>65536)req.destroy(new Error("WEBHOOK_RESPONSE_TOO_LARGE"));});
      res.on("end",()=>{clearTimeout(timer);resolve({status:res.statusCode??0,durationMs:Date.now()-started});});
    });
    const timer=setTimeout(()=>req.destroy(new Error("WEBHOOK_TIMEOUT")),Math.max(1,5000-(Date.now()-started)));
    req.on("error",()=>{clearTimeout(timer);reject(new Error("WEBHOOK_NETWORK_ERROR"));});req.end(body);
  });
};

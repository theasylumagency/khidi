import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { verifyWebhookSignature } from "../packages/shared/src/webhook-signature.ts";
export { verifyWebhookSignature };
export class TestStorefrontClient {
  constructor(private baseUrl:string,private host:string,private store:string,private key:string) {
    const url=new URL(baseUrl);if(!["127.0.0.1","localhost","[::1]"].includes(url.hostname))throw new Error("Test client is loopback-only.");
  }
  async call(path:string,input?:unknown,idempotencyKey?:string,options:{host?:string;store?:string;headers?:Record<string,string>}={}) {
    const url=new URL("/api/v1/storefront/"+(options.store??this.store)+"/"+path,this.baseUrl),body=input===undefined ? undefined : JSON.stringify(input);
    return new Promise<{status:number;headers:import("node:http").IncomingHttpHeaders;body:any}>((resolve,reject)=>{
      const req=(url.protocol==="https:" ? httpsRequest : httpRequest)(url,{method:body===undefined ? "GET" : "POST",headers:{host:options.host??this.host,authorization:"Bearer "+this.key,
        ...(body===undefined ? {} : {"Content-Type":"application/json","Content-Length":Buffer.byteLength(body),...(idempotencyKey ? {"Idempotency-Key":idempotencyKey} : {})}),...options.headers}},res=>{
        let text="";res.setEncoding("utf8");res.on("data",chunk=>{text+=chunk;if(text.length>2000000)req.destroy(new Error("Response too large."));});
        res.on("end",()=>{clearTimeout(timer);try{resolve({status:res.statusCode??0,headers:res.headers,body:JSON.parse(text)});}catch{resolve({status:res.statusCode??0,headers:res.headers,body:{nonJson:true}});}});
      });const timer=setTimeout(()=>req.destroy(new Error("Local Hub request timeout.")),60000);req.on("error",e=>{clearTimeout(timer);reject(e);});req.end(body);
    });
  }
}
/** No mode field is read or supplied by this client. */
export async function exerciseStorefrontFlow(client:TestStorefrontClient,skuId:string) {
  const assert=(ok:unknown,message:string)=>{if(!ok)throw new Error(message);};
  const products=await client.call("products");assert(products.status===200&&products.body.items.some((p:any)=>p.skuId===skuId),"Public product missing.");
  const [prices,stock,delta]=await Promise.all([client.call("prices"),client.call("stock/"+skuId),client.call("products?updated_since="+encodeURIComponent("2000-01-01T00:00:00Z"))]);
  assert(prices.status===200&&prices.body.items.some((p:any)=>p.skuId===skuId&&p.basePrice?.amount===10000),"Public price missing.");
  assert(stock.status===200&&stock.body.availableToSell===60,"Initial stock incorrect.");
  assert(delta.status===200&&delta.body.items.some((p:any)=>p.skuId===skuId),"Catalog delta missing.");
  const reserveKey=randomUUID(),reserveInput={storefrontOrderRef:"Test-"+randomUUID().slice(0,8),paymentMethod:"CARD",items:[{skuId,quantity:1}]};
  const reserved=await client.call("reservations",reserveInput,reserveKey);assert(reserved.status===201&&reserved.body.status==="RESERVED","Reservation failed.");
  const replay=await client.call("reservations",reserveInput,reserveKey);assert(isDeepStrictEqual(replay.body,reserved.body),"Reserve replay changed.");
  const key=randomUUID(),input={confirmation:{deliveryMethod:"COURIER",shipBy:"2030-01-01",prices:[{skuId,finalUnitPriceMinor:10000,currency:"GEL"}]}};
  const paid=await client.call("reservations/"+reserved.body.reservationId+"/commit",input,key);
  assert(paid.status===200&&paid.body.status==="HANDED_OVER"&&paid.body.confirmation==="AUTO_ASSUMED","Simplified confirmation failed.");
  const again=await client.call("reservations/"+reserved.body.reservationId+"/commit",input,key);assert(isDeepStrictEqual(paid.body,again.body),"Payment replay changed.");
  const fulfilled=await client.call("fulfillment-requests/"+paid.body.fulfillmentRequestId);assert(fulfilled.status===200&&fulfilled.body.confirmation==="AUTO_ASSUMED","Fulfillment provenance missing.");
  const ensured=await client.call("fulfillment-requests",{reservationId:reserved.body.reservationId},randomUUID());assert(ensured.body.fulfillmentRequestId===paid.body.fulfillmentRequestId,"Duplicate fulfillment request.");
  assert((await client.call("stock/"+skuId)).body.availableToSell===59,"Replayed confirmation changed stock twice.");
  const text=JSON.stringify([products.body,reserved.body,paid.body,fulfilled.body]);assert(!/KH-\d|accounting|supplier|allocationId|poolId|fulfillmentMode|app\.khidi|email|phone|address/i.test(text),"Private data escaped.");
  return {reservationId:reserved.body.reservationId as string,fulfillmentRequestId:paid.body.fulfillmentRequestId as string};
}

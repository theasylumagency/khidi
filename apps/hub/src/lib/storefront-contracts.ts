import { z } from "zod";
import { zodJsonSchema } from "@khidi/shared/openapi";
import { commitSchema, confirmationSchema, extendSchema, releaseSchema, reserveSchema } from "@khidi/reservations";
import { ensureFulfillmentSchema, cancelStorefrontFulfillmentSchema } from "@khidi/fulfillment/storefront-api";
export const collectionQuerySchema=z.object({locale:z.enum(["ka","en"]).default("ka"),updated_since:z.string().datetime({offset:true}).optional(),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict();
const uuid=z.string().uuid();
export const apiCommands={reserve:reserveSchema,commit:commitSchema.omit({reservationId:true}),extend:extendSchema.omit({reservationId:true}),release:releaseSchema.omit({reservationId:true}),
  ensure:ensureFulfillmentSchema,cancel:cancelStorefrontFulfillmentSchema.omit({fulfillmentRequestId:true})};
const result=z.object({reservationId:uuid.optional(),fulfillmentRequestId:uuid.optional(),status:z.enum(["RESERVED","REQUESTED","HANDED_OVER","CANCELLED","RELEASED"]).optional(),
  expiresAt:z.string().datetime().optional(),confirmation:z.enum(["SCAN","MANUAL","AUTO_ASSUMED"]).optional(),requiresReturnToShelf:z.boolean().optional()}).strict();
const fulfillmentResult=z.object({fulfillmentRequestId:uuid,reservationId:uuid,storefrontOrderRef:z.string(),status:z.enum(["REQUESTED","PICKING","PICKED","ACTION_REQUIRED","HANDED_OVER","CANCELLED"]),
  deliveryMethod:z.enum(["DELIVERY","PICKUP"]),shipBy:z.string(),confirmation:z.enum(["SCAN","MANUAL","AUTO_ASSUMED"]).nullable(),requiresReturnToShelf:z.boolean(),
  lines:z.array(z.object({skuId:uuid,quantity:z.number().int(),finalUnitPriceMinor:z.number().int().nullable(),currency:z.string()}))}).strict();
export function storefrontOpenApi() {
  const base="/api/v1/storefront/{store}",paths:Record<string,unknown>={};
  const parameter=(name:string,location="path")=>({name,in:location,required:true,schema:{type:"string"}});
  for(const suffix of ["/products","/products/{sku}","/prices","/stock","/stock/{sku}","/fulfillment-requests/{id}"]) {
    const parameters:Record<string,unknown>[]= [parameter("store"),...(suffix.includes("{sku}") ? [parameter("sku")] : []),...(suffix.includes("{id}") ? [parameter("id")] : [])];
    if(!suffix.includes("{")) parameters.push(...Object.entries(collectionQuerySchema.shape).map(([name,schema])=>({name,in:"query",required:false,schema:zodJsonSchema(schema)})));
    paths[base+suffix]={get:{security:[{serviceKey:[]}],parameters,responses:{200:{description:"Own-store public projection; unpublished deltas are tombstones.",...(suffix.startsWith("/fulfillment") ? {content:{"application/json":{schema:zodJsonSchema(fulfillmentResult)}}} : {})},401:{description:"Invalid key"},403:{description:"Wrong scope"},404:{description:"Not public or not owned"},429:{description:"Per-key rate limit; Retry-After header"}}}};
  }
  const operations:[string,keyof typeof apiCommands,string][]=[
    ["/reservations","reserve","COD/PICKUP confirms here and requires confirmation. CARD/BANK must not include confirmation yet."],
    ["/reservations/{id}/commit","commit","CARD payment success / BANK approval and order acceptance. COD/PICKUP confirms at reserve."],
    ["/reservations/{id}/extend","extend","Explicit extension; commitments never expire."],
    ["/reservations/{id}/release","release","Release an active reservation; cancel fulfillment for commitments."],
    ["/fulfillment-requests","ensure","Ensure the complete request already created atomically by order confirmation; never creates a partial request."],
    ["/fulfillment-requests/{id}/cancel","cancel","Cancel before handover; staged units remain held until staff return/loss." ]
  ];
  for(const [suffix,name,description] of operations) paths[base+suffix]={post:{description:description+" Clients must handle REQUESTED and HANDED_OVER/AUTO_ASSUMED without knowing the Hub mode. One idempotency key covers the entire atomic call.",security:[{serviceKey:[]}],parameters:[parameter("store"),...(suffix.includes("{id}") ? [parameter("id")] : []),{name:"Idempotency-Key",in:"header",required:true,schema:{type:"string",format:"uuid"}}],
    requestBody:{required:true,content:{"application/json":{schema:zodJsonSchema(apiCommands[name])}}},responses:{200:{description:"Confirmed or replayed",content:{"application/json":{schema:zodJsonSchema(name==="ensure" ? fulfillmentResult : result)}}},201:{description:"Reserved / REQUESTED / HANDED_OVER with AUTO_ASSUMED",content:{"application/json":{schema:zodJsonSchema(result)}}},409:{description:"RESERVATION_EXPIRED or state/idempotency conflict; refund or create a new reservation after expiry."},429:{description:"Per-key rate limit; Retry-After header"}}}};
  return {openapi:"3.1.0",info:{title:"Khidi Storefront API",version:"1.0.0"},servers:[{url:"https://api.khidi.app"}],paths,components:{securitySchemes:{serviceKey:{type:"http",scheme:"bearer"}},schemas:{Confirmation:zodJsonSchema(confirmationSchema)}},
    "x-contract":"No customer data or unknown keys. Final prices cover original cart items; bundle components remain private. No CORS. Idempotent key issuance never persists raw credentials."};
}

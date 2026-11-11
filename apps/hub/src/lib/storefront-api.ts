import { NextResponse } from "next/server";
import { type DbExecutor, getDb } from "@khidi/db";
import { consumeStorefrontRateLimit, verifyStorefrontServiceCredential } from "@khidi/auth";
import { storefrontProduct, storefrontProducts } from "@khidi/publishing/storefront-api";
import { confirmOrder, releaseOrder, reserveOrder } from "@khidi/fulfillment";
import { cancelStorefrontFulfillment, ensureStorefrontFulfillment, getStorefrontFulfillment } from "@khidi/fulfillment/storefront-api";
import { extendReservation, parseInput } from "@khidi/reservations";
import { AppError } from "@khidi/shared";
import { z } from "zod";
import { readBoundedJson } from "@khidi/shared/input-limits";
import { assertStorefrontRequestHost, verifiedProxyClientIp } from "./host-isolation.ts";
import { apiCommands, collectionQuerySchema, storefrontOpenApi } from "./storefront-contracts.ts";
export const apiJson=(body:unknown,status=200,headers:Record<string,string>={})=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...headers}});
export function storefrontApiError(error:unknown) {
  if(error instanceof AppError) {
    const retry=error.details?.retryAfter;
    const status=typeof retry==="number" ? 429 : ({UNAUTHORIZED:401,FORBIDDEN:403,NOT_FOUND:404,VALIDATION_ERROR:400,PAYLOAD_TOO_LARGE:413,CONFLICT:409,IDEMPOTENCY_CONFLICT:409,PRECONDITION_FAILED:409,INVARIANT_VIOLATION:409,RECENT_AUTH_REQUIRED:403}[error.code]);
    return apiJson({error:status===429 ? "RATE_LIMITED" : error.code},status,typeof retry==="number" ? {"Retry-After":String(retry)} : {});
  }
  return apiJson({error:error instanceof SyntaxError ? "VALIDATION_ERROR" : "UNAVAILABLE"},error instanceof SyntaxError ? 400 : 503);
}
async function readJson(request:Request) {
  if(request.headers.get("content-type")?.split(";")[0]!=="application/json") throw new AppError("VALIDATION_ERROR","JSON required.");
  return readBoundedJson(request,65536);
}
export async function handleStorefrontApi(request:Request,params:{store:string;resource:string[]},
  verify:typeof verifyStorefrontServiceCredential,db:DbExecutor=getDb()) {
  try {
    assertStorefrontRequestHost(request);
    const authorization=request.headers.get("authorization")??"";
    if(!/^Bearer [^\s]{20,200}$/.test(authorization))throw new AppError("UNAUTHORIZED","Credential required.");
    const credential=await verify(db,{requestedStorefrontKey:params.store,rawApiKey:authorization.slice(7),clientIp:verifiedProxyClientIp(request)});
    await consumeStorefrontRateLimit(db,credential);
    const principal={type:"STOREFRONT_SERVICE" as const,storefrontId:credential.storefrontId,apiKeyId:credential.apiKeyId};
    const path=params.resource,resource=path[0],id=path[1];
    const url=new URL(request.url);
    if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw new AppError("VALIDATION_ERROR","Repeated query key.");
    const query=parseInput(collectionQuerySchema,Object.fromEntries(url.searchParams));
    if(request.method==="GET") {
      if(resource==="openapi" && path.length===1)return apiJson(storefrontOpenApi());
      if(resource==="fulfillment-requests" && path.length===2)return apiJson(await getStorefrontFulfillment(db,principal,parseInput(z.string().max(36).uuid(),id)));
      if(["products","prices","stock"].includes(resource??"") && path.length<=2) {
        const data=id ? {items:[await storefrontProduct(db,credential.storefrontId,parseInput(z.string().max(36).uuid(),id),query.locale)],nextCursor:null} : await storefrontProducts(db,credential.storefrontId,query);
        if(resource==="products")return apiJson(id ? data.items[0] : data);
        const items=data.items.map((p)=>"unpublished" in p ? p : resource==="prices" ? {skuId:p.skuId,...(p.basePrice ? {basePrice:p.basePrice} : {priceUnavailable:true})} : {skuId:p.skuId,availableToSell:p.available_to_sell});
        return apiJson(id ? items[0] : {...data,items});
      }
    } else if(request.method==="POST") {
      const key=parseInput(z.string().max(36).uuid(),request.headers.get("idempotency-key")),raw=await readJson(request);
      let result;
      if(resource==="reservations" && path.length===1)result=await reserveOrder(db,principal,key,parseInput(apiCommands.reserve,raw));
      else if(resource==="reservations" && path.length===3) {
        const reservationId=parseInput(z.string().max(36).uuid(),id),action=path[2];
        if(action==="commit")result=await confirmOrder(db,principal,key,{...parseInput(apiCommands.commit,raw),reservationId});
        else if(action==="extend")result=await extendReservation(db,principal,key,{...parseInput(apiCommands.extend,raw),reservationId});
        else if(action==="release")result=await releaseOrder(db,principal,key,{...parseInput(apiCommands.release,raw),reservationId});
      } else if(resource==="fulfillment-requests" && path.length===1)result=await ensureStorefrontFulfillment(db,principal,key,parseInput(apiCommands.ensure,raw));
      else if(resource==="fulfillment-requests" && path.length===3 && path[2]==="cancel")result=await cancelStorefrontFulfillment(db,principal,key,{...parseInput(apiCommands.cancel,raw),fulfillmentRequestId:parseInput(z.string().max(36).uuid(),id)});
      if(result)return apiJson(result.body,result.status);
    }
    throw new AppError("NOT_FOUND","Not found.");
  }catch(error){return storefrontApiError(error);}
}

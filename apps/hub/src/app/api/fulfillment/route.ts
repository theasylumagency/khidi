import { readBoundedText, parseBoundedObjectJson } from "@khidi/shared/input-limits";
import { getDb } from "@khidi/db";
import { assertRecentStrongAuth, assertRoleAllowed } from "@khidi/auth";
import { withDomainTransaction } from "@khidi/domain";
import { listFulfillmentOffice, fulfillmentOfficeAction } from "@khidi/fulfillment/office";
import { setFulfillmentMode, parseInput } from "@khidi/reservations";
import { configureStorefrontWebhook, retryWebhook } from "@khidi/publishing/webhooks";
import { AppError } from "@khidi/shared";
import { z } from "zod";
import { getCurrentPrincipal } from "../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../lib/scanning-response.ts";
export async function GET(){try{
  const p=await getCurrentPrincipal();if(!p)throw new AppError("UNAUTHORIZED","Login required.");assertRoleAllowed(p,["ADMIN","ORDER_MANAGER"]);
  return Response.json(await listFulfillmentOffice(getDb(),{type:"USER",userId:p.userId}),{headers:{"Cache-Control":"no-store"}});
}catch(e){return scanningErrorResponse(e);}}
export async function POST(request:Request){try{
  const p=await getCurrentPrincipal();if(!p)throw new AppError("UNAUTHORIZED","Login required.");assertRoleAllowed(p,["ADMIN","ORDER_MANAGER"]);assertSecurityOrigin(request);
  const text=await readBoundedText(request, 16384);if(text.length>16384)throw new AppError("VALIDATION_ERROR","Body too large.");
  const command=parseInput(z.object({action:z.enum(["office","mode","webhook","retry-webhook"]),input:z.unknown()}).strict(),parseBoundedObjectJson(text));
  const db=getDb(),staff={type:"USER" as const,userId:p.userId},key=request.headers.get("idempotency-key")??"";
  let result;
  if(command.action==="office")result=await fulfillmentOfficeAction(db,staff,key,command.input);
  else {
    assertRoleAllowed(p,["ADMIN"]);
    if(command.action==="mode")result=await setFulfillmentMode(db,staff,key,command.input);
    else if(command.action==="retry-webhook")result=await retryWebhook(db,staff,key,command.input);
    else result=await withDomainTransaction(db,{userId:p.userId},async(ctx)=>{
      await assertRecentStrongAuth(ctx.tx,p);return configureStorefrontWebhook(ctx.tx,staff,key,command.input);
    });
  }
  return Response.json(result.body,{status:result.status,headers:{"Cache-Control":"no-store"}});
}catch(e){return scanningErrorResponse(e);}}

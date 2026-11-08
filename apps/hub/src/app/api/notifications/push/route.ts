import { readBoundedText, parseBoundedObjectJson } from "@khidi/shared/input-limits";
import { getDb } from "@khidi/db";
import { managePushSubscription,pushSubscriptionStatus } from "@khidi/notifications";
import { vapidConfig } from "@khidi/notifications/push-config";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../../lib/scanning-response.ts";
export async function GET(request:Request){try{
 const p=await getCurrentPrincipal();if(!p)throw new AppError("UNAUTHORIZED","Login required.");
 const id=new URL(request.url).searchParams.get("browserDeviceId"),status=id?await pushSubscriptionStatus(getDb(),p,id):{enabled:false,infoOptIn:false};
 return Response.json({...status,publicKey:vapidConfig().publicKey},{headers:{"Cache-Control":"private, no-store"}});
}catch(e){return scanningErrorResponse(e);}}
export async function POST(request:Request){try{
 const p=await getCurrentPrincipal();if(!p)throw new AppError("UNAUTHORIZED","Login required.");assertSecurityOrigin(request);
 const text=await readBoundedText(request, 8192);if(text.length>8192)throw new AppError("VALIDATION_ERROR","Too large.");const raw=parseBoundedObjectJson(text);
 if(raw?.action==="ENABLE")vapidConfig();
 const result=await managePushSubscription(getDb(),p,request.headers.get("idempotency-key")??"",raw);
 return Response.json(result.body,{status:result.status,headers:{"Cache-Control":"private, no-store"}});
}catch(e){return scanningErrorResponse(e);}}

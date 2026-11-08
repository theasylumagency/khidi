import { getDb } from "@khidi/db";
import { listNotifications,notificationUnreadCount,updateNotification,setInstallmentReminderLead } from "@khidi/notifications";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../lib/scanning-response.ts";
export async function GET(request:Request){try{
 const p=await getCurrentPrincipal();if(!p)throw new AppError("UNAUTHORIZED","Login required.");
 const url=new URL(request.url),db=getDb();
 const body=url.searchParams.get("count")==="1" ? {unread:await notificationUnreadCount(db,p.userId)} : await listNotifications(db,p.userId,{...(url.searchParams.has("cursor")?{cursor:url.searchParams.get("cursor")}:{})});
 return Response.json(body,{headers:{"Cache-Control":"private, no-store"}});
}catch(e){return scanningErrorResponse(e);}}
export async function POST(request:Request){try{
 const p=await getCurrentPrincipal();if(!p)throw new AppError("UNAUTHORIZED","Login required.");assertSecurityOrigin(request);
 const text=await request.text();if(text.length>4096)throw new AppError("VALIDATION_ERROR","Too large.");
 const raw=JSON.parse(text),key=request.headers.get("idempotency-key")??"";
 const result=raw?.action==="LEAD"?await setInstallmentReminderLead(getDb(),p.userId,key,raw):await updateNotification(getDb(),p.userId,key,raw);
 return Response.json(result.body,{status:result.status,headers:{"Cache-Control":"private, no-store"}});
}catch(e){return scanningErrorResponse(e);}}

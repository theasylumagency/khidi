import { NextResponse,type NextRequest } from "next/server";
import { getDb } from "@khidi/db";
import { completeUserSetup,inspectUserSetup } from "@khidi/auth";
import { AppError } from "@khidi/shared";
import { t } from "@khidi/i18n";
import { getCurrentPrincipal,KHIDI_DEVICE_COOKIE } from "../../../../lib/session.ts";
import { readBoundedJson } from "../../../../lib/request-body.ts";
export async function POST(request:NextRequest) {
 try {
  const body=await readBoundedJson(request,4096);
  // The single-use setup token authenticates this ceremony. Never switch an existing session.
  const principal=await getCurrentPrincipal({ allowCatalogReviewer: true });if(principal)throw new AppError("FORBIDDEN","Sign out before account setup.");
  if(typeof body.token!=="string"||!["INSPECT","COMPLETE"].includes(String(body.action))||Object.keys(body).some(k=>!["action","token","secret"].includes(k)))throw new AppError("UNAUTHORIZED","Invalid setup link.");
  const result=body.action==="INSPECT"?await inspectUserSetup(getDb(),body.token)
   :typeof body.secret==="string"&&body.secret.length<=72?await completeUserSetup(getDb(),body.token,body.secret,request.cookies.get(KHIDI_DEVICE_COOKIE)?.value):null;
  if(!result)throw new AppError("VALIDATION_ERROR","Invalid credential.");
  return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(error) {
  const code=error instanceof AppError?error.code:"INTERNAL_ERROR";
  const status=code==="PAYLOAD_TOO_LARGE"?413:code==="FORBIDDEN"?403:code==="VALIDATION_ERROR"?400:code==="INTERNAL_ERROR"?500:401;
  return NextResponse.json({error:code,message:t(code==="VALIDATION_ERROR"?"users.credential_invalid":"users.setup_failed")},{status,headers:{"Cache-Control":"no-store"}});
 }
}

import { getDb } from "@khidi/db";
import { listStorefrontServiceKeys, manageStorefrontServiceKey, assertRoleAllowed } from "@khidi/auth";
import { getCurrentPrincipal } from "../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../lib/scanning-response.ts";
import { AppError } from "@khidi/shared";
export async function GET(){try{const p=await getCurrentPrincipal();if(!p)throw new AppError("UNAUTHORIZED","Login required.");assertRoleAllowed(p,["ADMIN"]);return Response.json(await listStorefrontServiceKeys(getDb(),p),{headers:{"Cache-Control":"no-store"}});}catch(e){return scanningErrorResponse(e);}}
export async function POST(request:Request){try{const p=await getCurrentPrincipal();if(!p)throw new AppError("UNAUTHORIZED","Login required.");assertRoleAllowed(p,["ADMIN"]);assertSecurityOrigin(request);
  const text=await request.text();if(text.length>16384)throw new AppError("VALIDATION_ERROR","Too large.");
  const result=await manageStorefrontServiceKey(getDb(),p,request.headers.get("idempotency-key")??"",JSON.parse(text));
  return Response.json(result.body,{status:result.status,headers:{"Cache-Control":"no-store"}});}catch(e){return scanningErrorResponse(e);}}

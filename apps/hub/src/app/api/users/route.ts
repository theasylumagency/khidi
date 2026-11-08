import { NextResponse } from "next/server";
import { getDb } from "@khidi/db";
import { manageUser } from "@khidi/auth";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../lib/session.ts";
import { readBoundedJson } from "../../../lib/request-body.ts";
import { scanningErrorResponse } from "../../../lib/scanning-response.ts";
export async function POST(request:Request) {
 try {
  const principal=await getCurrentPrincipal();if(!principal)throw new AppError("UNAUTHORIZED","Login required.");
  if(principal.role!=="ADMIN")throw new AppError("FORBIDDEN","Admin required.");
  const result=await manageUser(getDb(),principal,request.headers.get("Idempotency-Key")??"",await readBoundedJson(request,16384));
  return NextResponse.json(result.body,{status:result.status,headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return scanningErrorResponse(error);}
}

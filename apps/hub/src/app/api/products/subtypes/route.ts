import { NextResponse } from "next/server";
import { getDb } from "@khidi/db";
import { assertRecentStrongAuth } from "@khidi/auth";
import { executeIdempotent } from "@khidi/domain";
import { addProductSubtype,addSubtypeSchema } from "@khidi/products";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { readBoundedJson } from "../../../../lib/request-body.ts";
import { scanningErrorResponse } from "../../../../lib/scanning-response.ts";
export async function POST(request:Request) {
 try {
  const principal=await getCurrentPrincipal();if(!principal)throw new AppError("UNAUTHORIZED","Login required.");
  if(principal.role!=="ADMIN")throw new AppError("FORBIDDEN","Admin required.");
  const input=addSubtypeSchema.safeParse(await readBoundedJson(request,4096)),key=request.headers.get("Idempotency-Key")??"";
  if(!input.success||! /^[0-9a-f-]{36}$/i.test(key))throw new AppError("VALIDATION_ERROR","Invalid subtype.");
  const db=getDb();await assertRecentStrongAuth(db,principal);
  const result=await executeIdempotent(db,{scope:"product-subtype:"+principal.userId,idempotencyKey:key,payload:input.data},async tx=>{
   await assertRecentStrongAuth(tx,principal);return {status:201,body:await addProductSubtype(tx,{userId:principal.userId},input.data)};
  });
  return NextResponse.json(result.body,{status:result.status,headers:{"Cache-Control":"no-store"}});
 }catch(error){return scanningErrorResponse(error);}
}

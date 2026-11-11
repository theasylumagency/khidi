import { NextResponse } from "next/server";
import { getDb,getPostgresError } from "@khidi/db";
import { assertRecentStrongAuth } from "@khidi/auth";
import { executeIdempotent } from "@khidi/domain";
import { createLegalEntity,createLegalEntitySchema } from "@khidi/entities";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../lib/session.ts";
import { readBoundedJson } from "../../../lib/request-body.ts";
import { scanningErrorResponse } from "../../../lib/scanning-response.ts";
export async function POST(request:Request) {
 try {
  const principal=await getCurrentPrincipal();if(!principal)throw new AppError("UNAUTHORIZED","Login required.");
  if(principal.role!=="ADMIN")throw new AppError("FORBIDDEN","Admin required.");
  const input=createLegalEntitySchema.strict().safeParse(await readBoundedJson(request,4096)),key=request.headers.get("Idempotency-Key")??"";
  if(!input.success||! /^[0-9a-f-]{36}$/i.test(key))throw new AppError("VALIDATION_ERROR","Invalid entity.");
  const db=getDb();await assertRecentStrongAuth(db,principal);
  const result=await executeIdempotent(db,{scope:"entities:create:"+principal.userId,idempotencyKey:key,payload:input.data},async tx=>{
   await assertRecentStrongAuth(tx,principal);
   return {status:201,body:{id:(await createLegalEntity(tx,{userId:principal.userId},input.data)).id}};
  });
  return NextResponse.json(result.body,{status:result.status,headers:{"Cache-Control":"no-store"}});
 }catch(error){return scanningErrorResponse(getPostgresError(error)?.code==="23505"?new AppError("CONFLICT","Entity already exists."):error);}
}

import { readBoundedText, parseBoundedObjectJson } from "@khidi/shared/input-limits";
import { getDb } from "@khidi/db";
import { movementReport,exportReport,setReportAccess } from "@khidi/reports";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../lib/scanning-response.ts";
export async function GET(request:Request){try{
 const p=await getCurrentPrincipal();if(!p)throw new AppError("UNAUTHORIZED","Login required.");
 const q=new URL(request.url).searchParams,format=q.get("format");if(format!=="CSV"&&format!=="XLSX")throw new AppError("VALIDATION_ERROR","Invalid report format.");
 const report=await movementReport(getDb(),p.userId,{entityId:q.get("entityId")??"",from:q.get("from")??"",to:q.get("to")??"",availability:q.get("availability")==="1"});
 return new Response(new Uint8Array(await exportReport(report,format)),{headers:{"Content-Type":format==="CSV"?"text/csv; charset=utf-8":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "Content-Disposition":`attachment; filename="khidi-report.${format.toLowerCase()}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}catch(e){return scanningErrorResponse(e);}}
export async function POST(request:Request){try{
 const p=await getCurrentPrincipal();if(!p)throw new AppError("UNAUTHORIZED","Login required.");assertSecurityOrigin(request);
 const text=await readBoundedText(request, 4096);if(text.length>4096)throw new AppError("VALIDATION_ERROR","Too large.");
 const result=await setReportAccess(getDb(),p.userId,request.headers.get("idempotency-key")??"",parseBoundedObjectJson(text));
 return Response.json(result.body,{status:result.status,headers:{"Cache-Control":"private, no-store"}});
}catch(e){return scanningErrorResponse(e);}}

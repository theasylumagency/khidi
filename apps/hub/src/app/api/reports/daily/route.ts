import { getDb } from "@khidi/db";
import { getMediaStorage } from "@khidi/media";
import { downloadDailyReport } from "@khidi/reports";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { scanningErrorResponse } from "../../../../lib/scanning-response.ts";
export async function GET(request:Request){try{
 const p=await getCurrentPrincipal();if(!p)throw new AppError("UNAUTHORIZED","Login required.");
 const file=await downloadDailyReport(getDb(),getMediaStorage(),p.userId,Object.fromEntries(new URL(request.url).searchParams));
 return new Response(new Uint8Array(file.bytes),{headers:{"Content-Type":file.format==="CSV"?"text/csv; charset=utf-8":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
 "Content-Disposition":`attachment; filename="khidi-daily.${file.format.toLowerCase()}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
}catch(e){return scanningErrorResponse(e);}}

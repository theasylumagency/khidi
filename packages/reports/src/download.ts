import { createHmac,timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "@khidi/db";
import type { MediaStorage } from "@khidi/media/storage";
import { mediaSigningSecret } from "@khidi/media/signing";
import { AppError } from "@khidi/shared";
import { z } from "zod";
import { dailyReportDetails } from "./daily.ts";
const input=z.object({id:z.string().max(36).uuid(),format:z.enum(["CSV","XLSX"]),expires:z.coerce.number().int(),signature:z.string().max(64).regex(/^[a-f0-9]{64}$/)}).strict();
const signature=(userId:string,id:string,format:string,expires:number,key:string)=>createHmac("sha256",key).update(JSON.stringify(["khidi-report-v1",userId,id,format,expires])).digest("hex");
export function signReportDownload(userId:string,id:string,format:"CSV"|"XLSX",now=Date.now(),key=mediaSigningSecret()) {
 const expires=Math.floor(now/1000)+300;return "/api/reports/daily?"+new URLSearchParams({id,format,expires:String(expires),signature:signature(userId,id,format,expires,key)});
}
export function verifyReportDownload(userId:string,raw:unknown,now=Date.now(),key=mediaSigningSecret()) {
 const parsed=input.safeParse(raw);if(!parsed.success)throw new AppError("FORBIDDEN","Invalid private report URL.");
 const v=parsed.data,seconds=Math.floor(now/1000);
 if(v.expires<=seconds||v.expires>seconds+300||!timingSafeEqual(Buffer.from(v.signature,"hex"),Buffer.from(signature(userId,v.id,v.format,v.expires,key),"hex")))
  throw new AppError("FORBIDDEN","Private report URL expired or invalid.");
 return v;
}
export async function downloadDailyReport(db:DbExecutor,storage:MediaStorage,userId:string,raw:unknown,now=Date.now()) {
 const input=verifyReportDownload(userId,raw,now);await dailyReportDetails(db,userId,input.id);
 const result=await db.execute(sql`SELECT storage_key AS key,sha256,storage_version_id AS version FROM daily_report_files WHERE report_id=${input.id}::uuid AND format=${input.format}`);
 const file=result.rows[0] as {key:string;sha256:string;version:string|undefined}|undefined;
 if(!file)throw new AppError("NOT_FOUND","Report file not found.");
 return {bytes:await storage.readPrivate(file.key,file.sha256,file.version),format:input.format};
}

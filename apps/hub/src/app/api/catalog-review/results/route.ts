import { assertRoleAllowed } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { listPilot,roundDetails,reviewRoles } from "@khidi/catalog-review";
import { exportWorkbook } from "@khidi/reports";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { pilotReport } from "../../../../lib/catalog-feedback-report.ts";

export async function GET(request:Request) {
  const headers={"Cache-Control":"private, no-store"};
  try {
    const principal=await getCurrentPrincipal({allowCatalogReviewer:true});
    if (!principal) return new Response(null,{status:401,headers});
    assertRoleAllowed(principal,[...reviewRoles]);
    const round=Number(new URL(request.url).searchParams.get("round"));
    if (!Number.isSafeInteger(round) || round<1) return new Response(null,{status:400,headers});
    const db=getDb(), rows=await listPilot(db,principal,round);
    if (!rows.length) return new Response(null,{status:404,headers});
    const {survey,closure}=await roundDetails(db,rows);
    const bytes=await exportWorkbook(pilotReport(rows,survey?.answers,closure));
    return new Response(new Uint8Array(bytes),{headers:{...headers,
      "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":'attachment; filename="catalog-feedback-'+round+'.xlsx"'}});
  } catch(error) {return new Response(null,{status:error instanceof AppError && error.code==="FORBIDDEN"?403:500,headers});}
}

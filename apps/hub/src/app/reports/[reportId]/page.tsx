import { getDb } from "@khidi/db";
import { dailyReportDetails,signReportDownload } from "@khidi/reports";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../../lib/session.ts";
export const dynamic="force-dynamic";
export default async function DailyReportPage({params}:{params:Promise<{reportId:string}>}) {
 const p=await requirePageAuth({allowedRoles:["ADMIN","OPERATOR","ORDER_MANAGER","STOCK_MANAGER"]}),{reportId}=await params;
 const report=await dailyReportDetails(getDb(),p.userId,reportId);
 return <section><h1>{t("reports.daily")} · {report.day}</h1><p>{t("reports.private_download")}</p>
  <p><a href={signReportDownload(p.userId,report.id,"CSV")}>{t("reports.download_csv")}</a> · <a href={signReportDownload(p.userId,report.id,"XLSX")}>{t("reports.download_xlsx")}</a></p></section>;
}

import { getDb } from "@khidi/db";
import { reportEntities,movementReport,reportSheets,reportAccessSettings } from "@khidi/reports";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../lib/session.ts";
import { ReportAccess } from "../../components/report-access.tsx";
import "../../components/inventory.css";
export const dynamic="force-dynamic";
export default async function ReportsPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const p=await requirePageAuth({allowedRoles:["ADMIN","OPERATOR","STOCK_MANAGER","ORDER_MANAGER"]}),db=getDb(),q=await searchParams;
 const entities=await reportEntities(db,p.userId),today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tbilisi",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const input={entityId:q.entityId??entities[0]?.id??"",from:q.from??today,to:q.to??today,availability:q.availability==="1"};
 const report=input.entityId?await movementReport(db,p.userId,input):null,query=new URLSearchParams({...input,availability:input.availability?"1":"0"});
 return <div className="inventory-workspace"><h1>{t("reports.title")}</h1><p>{t("reports.policy")}</p><form>
  <label>{t("reports.entity")}<select name="entityId" defaultValue={input.entityId}>{entities.map(e=><option key={e.id} value={e.id}>{e.legalName}</option>)}</select></label>
  <label>{t("reports.from")}<input type="date" name="from" defaultValue={input.from} required/></label><label>{t("reports.to")}<input type="date" name="to" defaultValue={input.to} required/></label>
  <label><input type="checkbox" name="availability" value="1" defaultChecked={input.availability}/>{t("reports.availability_option")}</label><button>{t("reports.show")}</button></form>
  {report?<><p><a href={"/api/reports?"+query+"&format=CSV"}>{t("reports.download_csv")}</a> · <a href={"/api/reports?"+query+"&format=XLSX"}>{t("reports.download_xlsx")}</a></p>
   <p>{t("reports.preview")}</p>{reportSheets(report).map(s=><section key={s.name}><h2>{s.name}</h2><div className="inventory-scroll"><table><thead><tr>{s.headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{s.rows.slice(0,100).map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table></div></section>)}</>:null}
  {p.role==="ADMIN"?<ReportAccess rows={await reportAccessSettings(db,p.userId)}/>:null}</div>;
}

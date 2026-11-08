import { getDb } from "@khidi/db";
import { auditHistory,inventoryHistory,historyEntities,type AuditFilter } from "@khidi/reports/audit";
import { t } from "@khidi/i18n";
import { formatTbilisiDateTime } from "@khidi/shared";
import { requirePageAuth } from "../../lib/session.ts";
import "../../components/inventory.css";
export const dynamic="force-dynamic";
export default async function HistoryPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
 const p=await requirePageAuth({allowedRoles:["ADMIN","STOCK_MANAGER"]}),db=getDb(),params=await searchParams,admin=p.role==="ADMIN";
 const keys=admin?["from","to","actorType","actorId","entityType","entityId","entityIdScope","action","correlationId","cursor"]:["from","to","entityIdScope","cursor"];
 const q=Object.fromEntries(keys.filter(k=>params[k]).map(k=>[k,params[k]!])) as AuditFilter,entities=await historyEntities(db,p.userId);
 const audit=admin?await auditHistory(db,p.userId,q):null,inventory=admin?null:await inventoryHistory(db,p.userId,q),cursor=audit?.nextCursor??inventory?.nextCursor;
 const next=new URLSearchParams({...Object.fromEntries(Object.entries(q).filter(([k])=>k!=="cursor")),cursor:cursor??""});
 return <div className="inventory-workspace"><h1>{t(admin?"history.audit":"history.inventory")}</h1><p>{t(admin?"history.audit_hint":"history.inventory_hint")}</p><form>
  <label>{t("reports.from")}<input type="date" name="from" defaultValue={q.from}/></label><label>{t("reports.to")}<input type="date" name="to" defaultValue={q.to}/></label>
  <label>{t("reports.entity")}<select name="entityIdScope" defaultValue={q.entityIdScope??""}><option value="">{t("history.all")}</option>{entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
  {admin?<><label>{t("history.actor")}<select name="actorType" defaultValue={q.actorType??""}><option value="">{t("history.all")}</option>{(["USER","STOREFRONT_SERVICE","SYSTEM_JOB","SYSTEM_WORKFLOW"] as const).map(v=><option key={v} value={v}>{t(`history.actor.${v}`)}</option>)}</select></label>
   {(["actorId","entityType","entityId","action","correlationId"] as const).map(k=><label key={k}>{t(`history.${k}`)}<input name={k} defaultValue={q[k]} maxLength={k==="action"||k==="entityType"?100:200}/></label>)}</>:null}
  <button>{t("reports.show")}</button><a href="/history">{t("history.reset")}</a></form>
  <div className="inventory-scroll">{audit?<table><thead><tr>{(["time","actor","action","object","before","after","reason","correlationId"] as const).map(k=><th key={k}>{t(`history.${k}`)}</th>)}</tr></thead><tbody>{audit.rows.map(r=><tr key={r.id}>
   <td>{formatTbilisiDateTime(r.createdAt)}</td><td>{r.actorType??(r.actorUserId?"USER":"")}<br/>{r.actorId??r.actorUserId}</td><td>{r.action}</td><td>{r.entityType}<br/>{r.entityId}</td>
   <td><pre>{JSON.stringify(r.beforeJson,null,2)}</pre></td><td><pre>{JSON.stringify(r.afterJson,null,2)}</pre></td><td>{r.reason}<br/>{r.externalDocumentRef}</td><td>{r.correlationId}<br/>{r.triggerCallId}</td>
  </tr>)}</tbody></table>:<table><thead><tr>{(["time","action","sku","quantity","pool","deltas","reason","correlationId"] as const).map(k=><th key={k}>{t(`history.${k}`)}</th>)}</tr></thead><tbody>{inventory!.rows.map(r=><tr key={r.id}>
   <td>{formatTbilisiDateTime(r.date)}</td><td>{r.movement}</td><td>{r.sku}</td><td>{r.quantity}</td><td>{r.pool}</td><td>{r.shelfDelta} / {r.stagingDelta} / {r.allocatedDelta} / {r.reservedDelta} / {r.committedDelta}</td>
   <td>{r.reason}<br/>{r.document}</td><td>{r.correlation}</td></tr>)}</tbody></table>}</div>
  {cursor?<a href={"/history?"+next}>{t("notification.next")}</a>:null}</div>;
}

import Link from "next/link";
import { getDb } from "@khidi/db";
import { listStorefrontServiceKeys } from "@khidi/auth";
import { listFulfillmentOffice } from "@khidi/fulfillment/office";
import { listWebhookDeliveries } from "@khidi/publishing/webhooks";
import { t, type TranslationKey } from "@khidi/i18n";
import { requirePageAuth } from "../../lib/session.ts";
import { FulfillmentSettings } from "../../components/fulfillment-settings.tsx";
import "../../components/inventory.css";
export const dynamic="force-dynamic";
const date=(d:Date)=>new Intl.DateTimeFormat("ka-GE",{timeZone:"Asia/Tbilisi",dateStyle:"short",timeStyle:"short",hourCycle:"h23"}).format(d);
export default async function FulfillmentPage({searchParams}:{searchParams:Promise<{status?:string}>}) {
  const p=await requirePageAuth({allowedRoles:["ADMIN","ORDER_MANAGER"]}),db=getDb(),staff={type:"USER" as const,userId:p.userId};
  const query=await searchParams;
  const [view,settings]=await Promise.all([listFulfillmentOffice(db,staff,query.status==="ACTION_REQUIRED"),p.role==="ADMIN" ? Promise.all([db.query.storefronts.findMany({columns:{id:true,name:true,webhookUrl:true}}),listStorefrontServiceKeys(db,p),listWebhookDeliveries(db,staff)]) : Promise.resolve(null)]);
  const rows=view.requests;
  return <section className="inventory-workspace"><h1>{t("fulfillment.title")}</h1><p>{t("fulfillment.overview_hint")}</p>
    <nav><Link href="/fulfillment">{t("fulfillment.all")}</Link>{" · "}<Link href="/fulfillment?status=ACTION_REQUIRED">{t("fulfillment.ACTION_REQUIRED")}</Link></nav>
    <div className="inventory-scroll"><table><thead><tr>{["order","store","status","ship_by","confirmation"].map((k)=><th key={k}>{t(("fulfillment."+k) as TranslationKey)}</th>)}</tr></thead><tbody>{rows.map((r)=><tr key={r.id}>
      <td><Link href={"/fulfillment/"+r.id}>{r.orderRef}</Link></td><td>{r.store}</td><td>{t(("fulfillment."+r.status) as TranslationKey)}{r.requiresReturnToShelf?<p>{t("fulfillment.return_required")}</p>:null}</td><td>{r.shipBy}</td><td>{r.confirmation?t(("fulfillment."+r.confirmation) as TranslationKey):"—"}</td>
    </tr>)}</tbody></table>{!rows.length?<p>{t("fulfillment.empty")}</p>:null}</div>
    <h2>{t("fulfillment.reservation_expiry")}</h2><p>{t("fulfillment.expiry_hint")}</p>
    <div className="inventory-scroll"><table><thead><tr>{["order","store","payment","expires"].map((k)=><th key={k}>{t(("fulfillment."+k) as TranslationKey)}</th>)}</tr></thead><tbody>{view.expiry.map((r)=><tr key={r.id}><td>{r.orderRef}</td><td>{r.store}</td><td>{t(("fulfillment."+r.paymentMethod) as TranslationKey)}</td><td>{date(r.expiresAt)}</td></tr>)}</tbody></table></div>
    {settings&&view.mode?<FulfillmentSettings mode={view.mode} stores={settings[0]} keys={settings[1].map((k)=>({...k,expiresAt:k.expiresAt?.toISOString()??null,lastUsedAt:k.lastUsedAt?.toISOString()??null}))} deliveries={settings[2].map((r)=>({...r.delivery,eventType:r.eventType}))}/>:null}
  </section>;
}

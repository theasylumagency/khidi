import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@khidi/db";
import { getFulfillmentOfficeDetail } from "@khidi/fulfillment/office";
import { t, type TranslationKey } from "@khidi/i18n";
import { AppError } from "@khidi/shared";
import { requirePageAuth } from "../../../lib/session.ts";
import { FulfillmentActions } from "../../../components/fulfillment-actions.tsx";
import "../../../components/inventory.css";
export const dynamic="force-dynamic";
const date=(d:Date)=>new Intl.DateTimeFormat("ka-GE",{timeZone:"Asia/Tbilisi",dateStyle:"short",timeStyle:"short",hourCycle:"h23"}).format(d);
export default async function FulfillmentDetail({params}:{params:Promise<{id:string}>}) {
  const p=await requirePageAuth({allowedRoles:["ADMIN","ORDER_MANAGER"]}),{id}=await params;
  const detail=await getFulfillmentOfficeDetail(getDb(),{type:"USER",userId:p.userId},id).catch((e)=>{if(e instanceof AppError&&["NOT_FOUND","VALIDATION_ERROR"].includes(e.code))notFound();throw e;});
  const r=detail.request;
  return <section className="inventory-workspace"><Link href="/fulfillment">{t("fulfillment.title")}</Link><h1>{r.storefrontOrderRef}</h1>
    <p>{detail.storeName} · {t(("fulfillment."+r.status) as TranslationKey)} · {t(("fulfillment."+detail.paymentMethod) as TranslationKey)}</p>
    <p>{t("fulfillment.ship_by")}: {r.shipBy} · {t(("fulfillment."+r.deliveryMethod) as TranslationKey)}</p>
    {detail.expiresAt?<p>{t("fulfillment.expires")}: {date(detail.expiresAt)}</p>:null}
    {r.requiresReturnToShelf?<p role="status">{t("fulfillment.return_required")}</p>:null}
    {r.status==="HANDED_OVER"?<p>{t("fulfillment.closed_hint")}</p>:null}
    <div className="inventory-scroll"><table><thead><tr>{["product","quantity","picked","returned","lost_quantity","handed_over"].map((k)=><th key={k}>{t(("fulfillment."+k) as TranslationKey)}</th>)}</tr></thead><tbody>{detail.lines.map((l)=><tr key={l.id}><td><Link href={"/products/"+l.skuId}>{l.code}</Link></td><td>{l.quantity}</td><td>{l.picked}</td><td>{l.returned}</td><td>{l.lost}</td><td>{l.handedOver}</td></tr>)}</tbody></table></div>
    <FulfillmentActions id={id} canCancel={detail.canCancel} canMarkLost={detail.canMarkLost} lines={detail.lines.map((l)=>({...l,staged:l.picked-l.returned-l.lost-l.handedOver}))}/>
    <h2>{t("fulfillment.history")}</h2><p>{t("fulfillment.provenance_hint")}</p>
    <div className="inventory-scroll"><table><thead><tr>{["time","status","confirmation","executor","trigger","reason"].map((k)=><th key={k}>{t(("fulfillment."+k) as TranslationKey)}</th>)}</tr></thead><tbody>{detail.history.map((h)=><tr key={h.id}>
      <td>{date(h.createdAt)}</td><td>{t(("fulfillment."+h.toStatus) as TranslationKey)}</td><td>{h.confirmation?t(("fulfillment."+h.confirmation) as TranslationKey):"—"}</td><td>{t(("fulfillment."+h.actorType) as TranslationKey)}<small> · {h.actorId}</small></td><td>{h.triggerApiKeyId??"—"}</td><td>{h.reason??"—"}</td>
    </tr>)}</tbody></table></div>
    <h2>{t("fulfillment.units")}</h2><div className="inventory-scroll"><table><thead><tr>{["time","product","step","confirmation","quantity","reason"].map((k)=><th key={k}>{t(("fulfillment."+k) as TranslationKey)}</th>)}</tr></thead><tbody>{detail.confirmations.map((c)=><tr key={c.id}>
      <td>{date(c.createdAt)}</td><td>{detail.lines.find((l)=>l.skuId===c.skuId)?.code}</td><td>{t(("fulfillment."+c.action) as TranslationKey)}</td><td>{t(("fulfillment."+c.method) as TranslationKey)}</td><td>{c.quantity}</td><td>{c.reason??"—"}</td>
    </tr>)}</tbody></table></div>
  </section>;
}

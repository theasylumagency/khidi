import Link from "next/link";
import { getDb } from "@khidi/db";
import { listMissingEvidence } from "@khidi/evidence";
import { t, type TranslationKey } from "@khidi/i18n";
import { listInventoryActions } from "@khidi/inventory";
import { InventoryReplenishment } from "../../components/inventory-replenishment.tsx";
import { listSkusRequiringContentReview } from "@khidi/products";
import { requirePageAuth } from "../../lib/session.ts";

export const dynamic = "force-dynamic";
export default async function NotificationsPage() {
  const principal = await requirePageAuth();
  const stock=["ADMIN","STOCK_MANAGER"].includes(principal.role)?await listInventoryActions(getDb(),{userId:principal.userId}):null;
  const [identity, content] = principal.role === "ADMIN" ? await Promise.all([
    listMissingEvidence(getDb(), { userId: principal.userId }), listSkusRequiringContentReview(getDb())
  ]) : [[], []];
  const actions = [
    ...identity.filter((sku) => sku.reverificationRequired).map((sku) => ({ ...sku, reason: "evidence.reverification" as const })),
    ...content.map((sku) => ({ ...sku, reason: "content.review_required" as const }))
  ];
  return <section className="office-login">
    <h1>{t("evidence.notifications")}</h1>
    {actions.length ? <ul>{actions.map((sku) => <li key={`${sku.id}:${sku.reason}`}>
      <Link href={`/products/${sku.id}`}>{sku.name ?? sku.internalSku}</Link> · {t(sku.reason)}
    </li>)}</ul> : <p>{t("evidence.no_actions")}</p>}
    {principal.role === "ADMIN" ? <Link href="/evidence/missing">{t("evidence.missing")}</Link> : null}
    {stock?<><h2>{t("inventory.notifications")}</h2><ul>{stock.notifications.map(({notification,code,storeName})=><li key={notification.id}>
      {code} · {storeName}: {t(("inventory.status."+notification.status) as TranslationKey)} · {t("inventory.free")}: {notification.availableToSell} · {notification.createdAt.toLocaleString("ka-GE",{timeZone:"Asia/Tbilisi"})}
    </li>)}</ul><InventoryReplenishment requests={stock.requests.map((r)=>({id:r.request.id,skuId:r.allocation.skuId,storefrontId:r.allocation.storefrontId,code:r.code,storeName:r.storeName,quantity:r.request.requestedQuantity,status:r.request.status}))}/></>:null}
  </section>;
}

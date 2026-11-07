"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t, type TranslationKey } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import { inventoryPost } from "./inventory-client.ts";
import "./inventory.css";

export interface ReplenishmentRow {id:string;skuId:string;storefrontId:string;code:string;storeName:string;quantity:number;status:string}
export function InventoryReplenishment({requests}:{requests:ReplenishmentRow[]}) {
  const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [pending,setPending]=useState<{requestId:string;status:"ACKNOWLEDGED"|"DECLINED";key:string}|null>(null);
  async function commit() {
    if(!pending)return;setBusy(true);setMessage("");
    try{await inventoryPost("respond",{requestId:pending.requestId,status:pending.status},pending.key);setPending(null);setMessage(t("inventory.saved"));router.refresh();}
    catch(error){setMessage(error instanceof Error?error.message:t("scanning.error"));}finally{setBusy(false);}
  }
  return <section className="inventory-workspace"><h2>{t("inventory.replenishment")}</h2><p>{t("inventory.request_only")}</p>
    {pending?<div className="inventory-confirm"><p>{requests.find((r)=>r.id===pending.requestId)?.code} · {t(("inventory.status."+pending.status) as TranslationKey)}</p>
      <button disabled={busy} onClick={()=>void commit()}>{t("inventory.confirm")}</button> <button disabled={busy} onClick={()=>setPending(null)}>{t("inventory.cancel")}</button></div>:null}
    {requests.length?<div className="inventory-scroll"><table><thead><tr><th>{t("inventory.product")}</th><th>{t("inventory.store")}</th><th>{t("inventory.quantity")}</th><th>{t("inventory.replenishment")}</th></tr></thead><tbody>
      {requests.map((r)=><tr key={r.id}><td><Link href={`/inventory?storefrontId=${r.storefrontId}&skuId=${r.skuId}`}>{r.code}</Link></td><td>{r.storeName}</td><td>{r.quantity}</td><td>{t(("inventory.status."+r.status) as TranslationKey)}
        {r.status==="OPEN"?<button disabled={busy} onClick={()=>setPending({requestId:r.id,status:"ACKNOWLEDGED",key:createUuidV7()})}>{t("inventory.acknowledge")}</button>:null}
        {["OPEN","ACKNOWLEDGED"].includes(r.status)?<><button disabled={busy} onClick={()=>setPending({requestId:r.id,status:"DECLINED",key:createUuidV7()})}>{t("inventory.decline")}</button> <Link href={`/inventory?storefrontId=${r.storefrontId}&skuId=${r.skuId}`}>{t("inventory.request_link")}</Link></>:null}
      </td></tr>)}
    </tbody></table></div>:<p>{t("inventory.no_rows")}</p>}
    <p role="status">{busy?t("inventory.loading"):message}</p>
  </section>;
}

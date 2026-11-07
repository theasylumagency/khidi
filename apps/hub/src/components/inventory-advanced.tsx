"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t, type TranslationKey } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import { inventoryPost } from "./inventory-client.ts";
import "./inventory.css";

interface Choice {id:string;name:string}
const operations=["STOCK_IN","STOCK_OUT","WRITE_OFF","ALLOCATE","DEALLOCATE","TRANSFER_SAME_POOL","TRANSFER_PURCHASE"] as const;
export function InventoryAdvanced({storefrontId,configured,pools,stores,entities,products,balances}:{storefrontId:string;configured:boolean;pools:Choice[];stores:Choice[];entities:Choice[];products:Choice[];balances:{pools:{poolId:string;poolName:string;skuId:string;code:string;shelf:number;staging:number;unallocated:number}[];assigned:{poolId:string;skuId:string;storefrontId:string;storeName:string;availableToSell:number;reserved:number;committed:number}[]}}) {
  const router=useRouter(),[operation,setOperation]=useState<typeof operations[number]>("STOCK_IN"),[pending,setPending]=useState<{action:string;input:Record<string,unknown>;summary:string[];key:string}|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const names=new Map([...pools,...stores,...entities,...products].map((p)=>[p.id,p.name]));
  const allocationOperation=["ALLOCATE","DEALLOCATE","TRANSFER_SAME_POOL"].includes(operation);
  async function prepare(event:FormEvent<HTMLFormElement>,action:string) {
    event.preventDefault();setBusy(true);setMessage("");
    const data=Object.fromEntries(new FormData(event.currentTarget));
    const input=Object.fromEntries(Object.entries(data).filter(([,value])=>value!=="")) as Record<string,unknown>;
    try {
      if(action==="advanced") {input.operation=operation;input.quantity=Number(input.quantity);await inventoryPost("advanced-preview",input);}
      const summary=Object.entries(input).map(([key,value])=>{
        const labels:Record<string,TranslationKey>={poolId:"inventory.source_pool",targetPoolId:"inventory.target_pool",storefrontId:"inventory.store",targetStorefrontId:"inventory.target_store",skuId:"inventory.product",quantity:"inventory.quantity",reason:"inventory.reason",documentRef:"inventory.document",ownerEntityId:"inventory.owner",name:"inventory.pool_name",fromEntityId:"inventory.from_entity",toEntityId:"inventory.to_entity",notes:"inventory.reason"};
        if(key==="operation") return t(("inventory.operation."+value) as TranslationKey);
        if(key==="mode") return t("inventory.mode")+": "+t(("inventory.mode."+value) as TranslationKey);
        return `${t(labels[key]??"inventory.reason")}: ${names.get(String(value))??String(value)}`;
      });
      setPending({action,input,summary,key:createUuidV7()});
    }catch(error){setMessage(error instanceof Error?error.message:t("scanning.error"));}finally{setBusy(false);}
  }
  async function commit() {
    if(!pending)return;setBusy(true);setMessage("");
    try{await inventoryPost(pending.action,pending.input,pending.key);setPending(null);setMessage(t("inventory.saved"));router.refresh();}
    catch(error){
      const blocked=(error as Error & {blockedAllocations?:{skuId?:string;storefrontId?:string;reserved:number;committed:number}[]}).blockedAllocations;
      setMessage((error instanceof Error?error.message:t("scanning.error"))+(blocked?.length?" "+blocked.map((b)=>`${names.get(b.skuId??"")??""} ${names.get(b.storefrontId??"")??""}: ${t("inventory.reserved")} ${b.reserved}, ${t("inventory.committed")} ${b.committed}`).join("; "):""));
    }finally{setBusy(false);}
  }
  const select=(name:string,choices:Choice[],label:TranslationKey)=><label>{t(label)}<select name={name} required>{choices.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>;
  return <details className="inventory-advanced"><summary>{t("inventory.advanced")}</summary>
    <div className="inventory-scroll"><table><thead><tr><th>{t("inventory.product")}</th><th>{t("inventory.pool")}</th><th>{t("inventory.shelf")}</th><th>{t("inventory.staging")}</th><th>{t("inventory.unallocated")}</th><th>{t("inventory.store")}</th></tr></thead><tbody>
      {balances.pools.map((p)=><tr key={p.poolId+p.skuId}><td>{p.code}</td><td>{p.poolName}</td><td>{p.shelf}</td><td>{p.staging}</td><td>{p.unallocated}</td><td>{balances.assigned.filter((a)=>a.poolId===p.poolId&&a.skuId===p.skuId).map((a)=><div key={a.storefrontId}>{a.storeName}: {t("inventory.free")} {a.availableToSell}, {t("inventory.reserved")} {a.reserved}, {t("inventory.committed")} {a.committed}</div>)}</td></tr>)}
    </tbody></table></div>
    {pending?<section className="inventory-confirm"><h2>{t("inventory.preview")}</h2><ul>{pending.summary.map((s,i)=><li key={i}>{s}</li>)}</ul>
      {pending.action==="configure-pool"?<p>{t("inventory.pool_once")}</p>:null}
      {pending.input.operation==="TRANSFER_PURCHASE"?<p>{t("inventory.cross_entity")}</p>:null}
      <button disabled={busy} onClick={()=>void commit()}>{t("inventory.confirm")}</button> <button disabled={busy} onClick={()=>setPending(null)}>{t("inventory.cancel")}</button></section>:<>
      <form onSubmit={(e)=>void prepare(e,"configure-pool")}><input type="hidden" name="storefrontId" value={storefrontId}/>{select("poolId",pools,"inventory.pool")}<button disabled={busy||!pools.length}>{t("inventory.configure")}</button><p>{t("inventory.pool_once")}</p></form>
      <h2>{t("inventory.operation")}</h2><form onSubmit={(e)=>void prepare(e,"advanced")}>
        <label>{t("inventory.operation")}<select value={operation} onChange={(e)=>setOperation(e.target.value as typeof operation)}>{operations.map((op)=><option key={op} value={op}>{t(("inventory.operation."+op) as TranslationKey)}</option>)}</select></label>
        {select("skuId",products,"inventory.product")}{select("poolId",pools,"inventory.source_pool")}
        {allocationOperation?select("storefrontId",stores,"inventory.store"):null}
        {operation==="TRANSFER_SAME_POOL"?select("targetStorefrontId",stores,"inventory.target_store"):null}
        {operation==="TRANSFER_PURCHASE"?select("targetPoolId",pools,"inventory.target_pool"):null}
        <label>{t("inventory.quantity")}<input type="number" name="quantity" min="1" step="1" required/></label>
        <label>{t("inventory.reason")}<input name="reason" required maxLength={1000}/></label>
        <label>{t("inventory.document")}<input name="documentRef" required={operation==="TRANSFER_PURCHASE"}/></label>
        <button disabled={busy||!pools.length||!products.length}>{t("inventory.preview")}</button>
      </form>{operation==="TRANSFER_PURCHASE"?<p className="inventory-risk">{t("inventory.cross_entity")}</p>:null}
      <h2>{t("inventory.create_pool")}</h2><form onSubmit={(e)=>void prepare(e,"create-pool")}>
        {select("ownerEntityId",entities,"inventory.owner")}<label>{t("inventory.pool_name")}<input name="name" required maxLength={120}/></label><button disabled={busy}>{t("inventory.preview")}</button>
      </form>
      <h2>{t("inventory.relationship")}</h2><form onSubmit={(e)=>void prepare(e,"relationship")}>
        {select("fromEntityId",entities,"inventory.from_entity")}{select("toEntityId",entities,"inventory.to_entity")}
        <label>{t("inventory.mode")}<select name="mode"><option value="CONSIGNMENT">{t("inventory.mode.CONSIGNMENT")}</option><option value="PURCHASE">{t("inventory.mode.PURCHASE")}</option></select></label>
        <label>{t("inventory.reason")}<input name="notes" required maxLength={500}/></label><button disabled={busy}>{t("inventory.preview")}</button>
      </form>
    </>}
    <p role="status">{busy?t("inventory.loading"):message}</p>
  </details>;
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t, type TranslationKey } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import { inventoryPost } from "./inventory-client.ts";
import "./inventory.css";

export interface InventoryRow {skuId:string;code:string;name:string;allocationId:string|null;availableToSell:number;reserved:number;committed:number;minimumStock:number;status:string}
interface RequestChoice {id:string;allocationId:string;status:string}
interface Preview {skuId:string;target:number;previousAvailable:number;delta:number;reserved:number;committed:number;replenishmentRequestId?:string}
export function AvailabilityConfirmation({preview,busy,onConfirm,onCancel}:{preview:Preview;busy:boolean;onConfirm:()=>void;onCancel:()=>void}) {
  return <section className="inventory-confirm" aria-label={t("inventory.preview")}>
    <h2>{t("inventory.free")}: {preview.previousAvailable} → {preview.target} ({preview.delta>=0?"+":""}{preview.delta})</h2>
    <p>{t("inventory.reserved")}: {preview.reserved} · {t("inventory.committed")}: {preview.committed}</p>
    <p>{t("inventory.protected")}</p>
    <button type="button" disabled={busy} onClick={onConfirm}>{t("inventory.confirm")}</button> <button type="button" disabled={busy} onClick={onCancel}>{t("inventory.cancel")}</button>
  </section>;
}
export function InventoryWorkspace({storefrontId,rows,requests,initialSearch=""}:{storefrontId:string;rows:InventoryRow[];requests:RequestChoice[];initialSearch?:string}) {
  const router=useRouter();
  const [search,setSearch]=useState(initialSearch),[targets,setTargets]=useState<Record<string,string>>({}),[linked,setLinked]=useState<Record<string,string>>({});
  const [preview,setPreview]=useState<Preview|null>(null),[key,setKey]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function prepare(row:InventoryRow) {
    setBusy(true);setMessage("");
    try {
      const target=Number(targets[row.skuId]??row.availableToSell);
      if((targets[row.skuId]??"0").trim()==="" || !Number.isInteger(target) || target<0) throw new Error(t("scanning.error.VALIDATION_ERROR"));
      const body=await inventoryPost("preview",{skuId:row.skuId,storefrontId,target,...(linked[row.skuId]?{replenishmentRequestId:linked[row.skuId]}:{})});
      setPreview(body.preview);setKey(createUuidV7());
    }catch(error){setMessage(error instanceof Error?error.message:t("scanning.error"));}finally{setBusy(false);}
  }
  async function commit() {
    if(!preview) return;setBusy(true);setMessage("");
    try {
      const result=await inventoryPost("set",{skuId:preview.skuId,storefrontId,target:preview.target,...(preview.replenishmentRequestId?{replenishmentRequestId:preview.replenishmentRequestId}:{})},key);
      setPreview(null);setTargets({});setMessage(`${t("inventory.saved")}: ${t("inventory.free")} ${result.previousAvailable} → ${result.availableToSell}`);router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:t("scanning.error"));}finally{setBusy(false);}
  }
  async function smallAction(action:string,input:unknown) {
    setBusy(true);setMessage("");try{await inventoryPost(action,input,createUuidV7());setMessage(t("inventory.saved"));router.refresh();}
    catch(error){setMessage(error instanceof Error?error.message:t("scanning.error"));}finally{setBusy(false);}
  }
  return <section className="inventory-workspace">
    <p className="inventory-risk">{t("inventory.risk")}</p>
    {preview?<AvailabilityConfirmation preview={preview} busy={busy} onConfirm={()=>void commit()} onCancel={()=>setPreview(null)}/>:<>
      <label>{t("inventory.search")} <input value={search} onChange={(e)=>setSearch(e.target.value)}/></label>
      <div className="inventory-scroll"><table><thead><tr>{["product","free","reserved","committed","target","minimum","replenishment"].map((k)=><th key={k}>{t(("inventory."+k) as TranslationKey)}</th>)}<th>{t("inventory.preview")}</th></tr></thead>
        <tbody>{rows.filter((r)=>(r.code+" "+r.name).toLowerCase().includes(search.toLowerCase())).map((row)=><tr key={row.skuId}>
          <td><Link href={`/products/${row.skuId}`}>{row.code}</Link><div>{row.name}</div><small>{row.allocationId?t(("inventory.status."+row.status) as TranslationKey):t("inventory.undeclared")}</small></td>
          <td>{row.allocationId?row.availableToSell:"—"}</td><td>{row.reserved}</td><td>{row.committed}</td>
          <td><input aria-label={t("inventory.target")+" "+row.code} type="number" min="0" step="1" value={targets[row.skuId]??row.availableToSell} onChange={(e)=>setTargets({...targets,[row.skuId]:e.target.value})}/></td>
          <td>{row.allocationId?<form onSubmit={(e)=>{e.preventDefault();const data=new FormData(e.currentTarget);void smallAction("minimum",{allocationId:row.allocationId,minimum:Number(data.get("minimum"))});}}>
            <input name="minimum" aria-label={t("inventory.minimum")+" "+row.code} type="number" min="0" required defaultValue={row.minimumStock}/><button disabled={busy}>{t("inventory.save_minimum")}</button></form>:"—"}</td>
          <td><select aria-label={t("inventory.request_link")+" "+row.code} value={linked[row.skuId]??""} onChange={(e)=>setLinked({...linked,[row.skuId]:e.target.value})}>
            <option value="">{t("inventory.none")}</option>{requests.filter((r)=>r.allocationId===row.allocationId&&["OPEN","ACKNOWLEDGED"].includes(r.status)).map((r)=><option key={r.id} value={r.id}>{t(("inventory.status."+r.status) as TranslationKey)}</option>)}</select>
            {row.allocationId?<form onSubmit={(e)=>{e.preventDefault();const data=new FormData(e.currentTarget);void smallAction("request",{allocationId:row.allocationId,quantity:Number(data.get("quantity"))});}}>
              <input name="quantity" type="number" min="1" defaultValue="1" required aria-label={t("inventory.quantity")+" "+row.code}/><button disabled={busy}>{t("inventory.request")}</button></form>:null}</td>
          <td><button type="button" disabled={busy} onClick={()=>void prepare(row)}>{t("inventory.preview")}</button></td>
        </tr>)}</tbody></table></div>
    </>}
    <p role="status">{busy?t("inventory.loading"):message}</p>
  </section>;
}

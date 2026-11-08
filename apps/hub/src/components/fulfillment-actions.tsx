"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import { fulfillmentPost } from "./fulfillment-client.ts";
export function FulfillmentActions({id,canCancel,canMarkLost,lines}:{id:string;canCancel:boolean;canMarkLost:boolean;lines:{id:string;code:string;staged:number}[]}) {
  const router=useRouter(),[action,setAction]=useState<"CANCEL"|"LOST"|null>(null),[reason,setReason]=useState(""),[lineId,setLineId]=useState(lines.find((l)=>l.staged>0)?.id??""),[key,setKey]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function submit(){setBusy(true);try{await fulfillmentPost("/api/fulfillment",{action:"office",input:{action,fulfillmentRequestId:id,reason,...(action==="LOST" ? {lineId} : {})}},key);setAction(null);setMessage(t("inventory.saved"));router.refresh();}
    catch(e){setMessage(e instanceof Error ? e.message : t("scanning.error"));}finally{setBusy(false);}}
  if(!canCancel&&!canMarkLost)return null;
  return <section><h2>{t("fulfillment.actions")}</h2>{!action?<>
    {canCancel?<button onClick={()=>{setAction("CANCEL");setKey(createUuidV7());setReason("");setMessage("");}}>{t("fulfillment.cancel")}</button>:null}{" "}
    {canMarkLost?<button onClick={()=>{setAction("LOST");setKey(createUuidV7());setReason("");setMessage("");}}>{t("fulfillment.lost")}</button>:null}
  </>:<form onSubmit={(e)=>{e.preventDefault();void submit();}}><p>{t(action==="CANCEL" ? "fulfillment.cancel_hint" : "fulfillment.lost_hint")}</p>
    <fieldset disabled={busy}>{action==="LOST"?<label>{t("inventory.product")}<select value={lineId} onChange={(e)=>{setLineId(e.target.value);setKey(createUuidV7());}}>{lines.filter((l)=>l.staged>0).map((l)=><option key={l.id} value={l.id}>{l.code}</option>)}</select></label>:null}
      <label>{t("fulfillment.reason")}<textarea required maxLength={1000} value={reason} onChange={(e)=>{setReason(e.target.value);setKey(createUuidV7());}}/></label>
      <button disabled={!reason.trim()}>{t("inventory.confirm")}</button>{" "}<button type="button" onClick={()=>setAction(null)}>{t("auth.cancel")}</button>
    </fieldset></form>}<p role="status">{busy?t("auth.checking"):message}</p></section>;
}

"use client";
import { useState } from "react";
import { t } from "@khidi/i18n";
type Row={userId:string;name:string;role:string;entityId:string;entity:string;granted:boolean;recipient:boolean};
export function ReportAccess({rows}:{rows:Row[]}) {
 const [message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 return <details><summary>{t("reports.access")}</summary><p>{t("reports.access_hint")}</p>{rows.map(row=><form key={row.userId+row.entityId} onSubmit={async e=>{
  e.preventDefault();if(busy)return;const data=new FormData(e.currentTarget);setBusy(true);
  try{const response=await fetch("/api/reports",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({userId:row.userId,entityId:row.entityId,granted:data.has("granted"),recipient:data.has("recipient")})});
   if(!response.ok)throw new Error();setMessage(t("reports.saved"));location.reload();
  }catch{setMessage(t("reports.failed"));}finally{setBusy(false);}
 }}><strong>{row.name} · {row.entity}</strong> <label><input type="checkbox" name="granted" defaultChecked={row.granted}/>{t("reports.granted")}</label> <label><input type="checkbox" name="recipient" defaultChecked={row.recipient}/>{t("reports.recipient")}</label> <button disabled={busy}>{t("reports.save")}</button></form>)}<p role="status">{message}</p></details>;
}

"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { t,type TranslationKey } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
type Row={id:string;titleKey:string;type:string;level:string;deepLink:string;createdAt:string;read:boolean;muted:boolean};
export function NotificationCenter({rows,nextCursor,preferences,leadHours}:{rows:Row[];nextCursor:string|null;preferences:{type:string;muted:boolean}[];leadHours?:number}) {
 const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function update(input:unknown){setBusy(true);try{const response=await fetch("/api/notifications",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":createUuidV7()},body:JSON.stringify(input)});const body=await response.json();if(!response.ok)throw new Error(body.error);setMessage("");window.dispatchEvent(new Event("khidi-notifications-changed"));router.refresh();}catch(e){setMessage(e instanceof Error?e.message:t("scanning.error"));}finally{setBusy(false);}}
 return <section className="inventory-workspace"><h1>{t("notification.title")}</h1><p>{t("notification.scope_hint")}</p>
  {rows.length?<div className="inventory-scroll"><table><thead><tr>{["state","time","message","action"].map(k=><th key={k}>{t(("notification."+k) as TranslationKey)}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id}>
   <td>{t(("notification.level."+row.level) as TranslationKey)} · {t(row.read?"notification.read":"notification.unread")}</td><td>{new Intl.DateTimeFormat("ka-GE",{timeZone:"Asia/Tbilisi",dateStyle:"short",timeStyle:"short",hourCycle:"h23"}).format(new Date(row.createdAt))}</td>
   <td>{t(row.titleKey as TranslationKey)}</td><td><Link href={row.deepLink}>{t("notification.open")}</Link>{" "}{!row.read?<button disabled={busy} onClick={()=>void update({action:"READ",notificationId:row.id})}>{t("notification.mark_read")}</button>:null}</td>
  </tr>)}</tbody></table></div>:<p>{t("notification.empty")}</p>}
  {nextCursor?<Link href={"/notifications?cursor="+nextCursor}>{t("notification.next")}</Link>:null}
  {leadHours!==undefined?<form onSubmit={e=>{e.preventDefault();void update({action:"LEAD",hours:Number(new FormData(e.currentTarget).get("hours"))});}}><label>{t("notification.lead_hours")}<input type="number" name="hours" min={1} max={8760} step={1} defaultValue={leadHours} required disabled={busy}/></label><button disabled={busy}>{t("inventory.confirm")}</button><p>{t("notification.lead_hint")}</p></form>:null}
  <details><summary>{t("notification.mute_title")}</summary><p>{t("notification.mute_hint")}</p>{preferences.map(p=><label key={p.type} style={{display:"block"}}><input type="checkbox" checked={p.muted} disabled={busy} onChange={e=>void update({action:"MUTE",type:p.type,muted:e.target.checked})}/>{t(("notification.type."+p.type) as TranslationKey)}</label>)}</details>
  <p role="status">{busy?t("auth.checking"):message}</p>
 </section>;
}

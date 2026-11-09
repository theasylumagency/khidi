"use client";
import { useRef,useState,type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t } from "@khidi/i18n";
import { StrongReauthentication } from "./strong-reauthentication.tsx";
import { adminSetupSender } from "../lib/admin-setup-client.ts";
type Type={key:string;name:string;values:{key:string;labelKa:string;labelEn:string;requiredSpecFields:string[]}[]};
export function SubtypeCreateForm({types,sharedDevice}:{types:Type[];sharedDevice:boolean}) {
 const router=useRouter(),sender=useRef<ReturnType<typeof adminSetupSender>|null>(null);
 const [typeKey,setTypeKey]=useState(types[0]?.key??""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[reauth,setReauth]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(busy)return;const form=event.currentTarget,data=new FormData(form);setBusy(true);setMessage("");
  try {
   sender.current??=adminSetupSender("/api/products/subtypes");const {response,body}=await sender.current({productTypeKey:typeKey,key:data.get("key"),labelKa:data.get("labelKa"),labelEn:data.get("labelEn")});
   if(response.status===428){setReauth(true);return;}if(!response.ok){setMessage(body.error??t("users.failed"));return;}
   form.reset();setMessage(t("users.saved"));router.refresh();
  }catch{setMessage(t("auth.network_error"));}finally{setBusy(false);}
 }
 return <section><h1>{t("setup.subtypes")}</h1><p>{t("setup.subtypes_help")}</p>
  {reauth?<StrongReauthentication sharedDevice={sharedDevice} onSuccess={()=>{setReauth(false);setMessage(t("users.retry"));}}/>:null}
  <label>{t("setup.product_type")}<select value={typeKey} onChange={e=>setTypeKey(e.target.value)}>{types.map(type=><option key={type.key} value={type.key}>{type.name}</option>)}</select></label>
  <table><thead><tr><th>{t("setup.key")}</th><th>{t("setup.label_ka")}</th><th>{t("setup.label_en")}</th><th>{t("setup.required_specs")}</th></tr></thead><tbody>{types.find(type=>type.key===typeKey)?.values.map(value=><tr key={value.key}><td>{value.key}</td><td>{value.labelKa}</td><td>{value.labelEn}</td><td>{value.requiredSpecFields.join(", ")||t("setup.specs_pending")}</td></tr>)}</tbody></table>
  <form onSubmit={submit}><fieldset disabled={busy||!typeKey}><label>{t("setup.key")}<input name="key" required minLength={2} maxLength={48} pattern="[A-Z][A-Z0-9_]*"/></label>
  <label>{t("setup.label_ka")}<input name="labelKa" required maxLength={120}/></label><label>{t("setup.label_en")}<input name="labelEn" required maxLength={120}/></label><button>{t("setup.create")}</button></fieldset></form><p role="status">{message}</p>
 </section>;
}

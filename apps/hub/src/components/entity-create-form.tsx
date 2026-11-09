"use client";
import { useRef,useState,type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t } from "@khidi/i18n";
import { StrongReauthentication } from "./strong-reauthentication.tsx";
import { adminSetupSender } from "../lib/admin-setup-client.ts";
export function EntityCreateForm({sharedDevice}:{sharedDevice:boolean}) {
 const router=useRouter(),sender=useRef<ReturnType<typeof adminSetupSender>|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[reauth,setReauth]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(busy)return;const form=event.currentTarget,data=new FormData(form);setBusy(true);setMessage("");
  try {
   sender.current??=adminSetupSender("/api/entities");
   const {response,body}=await sender.current({key:data.get("key"),legalName:data.get("legalName"),taxId:data.get("taxId"),pricesIncludeVat:data.get("vat")==="true"});
   if(response.status===428){setReauth(true);return;}if(!response.ok){setMessage(body.error??t("users.failed"));return;}
   form.reset();setMessage(t("users.saved"));router.refresh();
  }catch{setMessage(t("auth.network_error"));}finally{setBusy(false);}
 }
 return <section><h2>{t("setup.entity_create")}</h2><p>{t("setup.entity_help")}</p>
  {reauth?<StrongReauthentication sharedDevice={sharedDevice} onSuccess={()=>{setReauth(false);setMessage(t("users.retry"));}}/>:null}
  <form onSubmit={submit}><fieldset disabled={busy}><label>{t("setup.key")}<input name="key" required minLength={2} maxLength={32} pattern="[A-Z0-9_]+" autoCapitalize="characters"/></label>
  <label>{t("setup.legal_name")}<input name="legalName" required minLength={2} maxLength={200}/></label>
  <label>{t("setup.tax_id")}<input name="taxId" required minLength={5} maxLength={32} inputMode="numeric"/></label>
  <label>{t("setup.vat")}<select name="vat" required defaultValue=""><option value="" disabled>{t("setup.choose")}</option><option value="true">{t("setup.yes")}</option><option value="false">{t("setup.no")}</option></select></label><button>{t("setup.create")}</button></fieldset></form><p role="status">{message}</p>
 </section>;
}

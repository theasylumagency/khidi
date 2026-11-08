"use client";
import { useEffect,useState } from "react";
import { t } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
const DEVICE_KEY="khidi.push.device.v1";
export function NotificationPushSettings(){
 const [state,setState]=useState<{enabled:boolean;infoOptIn:boolean;publicKey:string}|null>(null),[supported,setSupported]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function refresh(){const id=localStorage.getItem(DEVICE_KEY);const response=await fetch("/api/notifications/push"+(id?"?browserDeviceId="+encodeURIComponent(id):""),{cache:"no-store"});if(!response.ok)throw new Error(t("notification.push_failed"));setState(await response.json());}
 useEffect(()=>{let active=true;const ok=window.isSecureContext&&"serviceWorker"in navigator&&"PushManager"in window&&"Notification"in window;setSupported(ok);if(ok)void refresh().catch(()=>{if(active)setMessage(t("notification.push_failed"));});return()=>{active=false;};},[]);
 async function post(input:unknown){const response=await fetch("/api/notifications/push",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":createUuidV7()},body:JSON.stringify(input)});const body=await response.json();if(!response.ok)throw new Error(body.error??t("notification.push_failed"));}
 async function action(kind:"ENABLE"|"DISABLE"|"INFO",infoOptIn=false){setBusy(true);setMessage("");try{
  if(kind==="ENABLE") {
   // Permission is requested only from this explicit user gesture.
   if(await Notification.requestPermission()!=="granted")throw new Error(t("notification.push_permission"));
   const id=localStorage.getItem(DEVICE_KEY)??createUuidV7();localStorage.setItem(DEVICE_KEY,id);if(localStorage.getItem(DEVICE_KEY)!==id)throw new Error(t("notification.push_storage"));
   const registration=await navigator.serviceWorker.ready,old=await registration.pushManager.getSubscription();
   if(old)await old.unsubscribe();
   const key=Uint8Array.from(atob(state!.publicKey.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
   const sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key.buffer});
   try{await post({action:kind,browserDeviceId:id,subscription:sub.toJSON(),infoOptIn:false});}catch(e){await sub.unsubscribe();throw e;}
  }else {
   const id=localStorage.getItem(DEVICE_KEY);if(!id)throw new Error(t("notification.push_storage"));
   await post({action:kind,browserDeviceId:id,...(kind==="INFO"?{infoOptIn}:{})});
   if(kind==="DISABLE"){const registration=await navigator.serviceWorker.getRegistration();await(await registration?.pushManager.getSubscription())?.unsubscribe();}
  }
  await refresh();setMessage(t("inventory.saved"));
 }catch(e){setMessage(e instanceof Error?e.message:t("notification.push_failed"));}finally{setBusy(false);}}
 return <section><h2>{t("notification.push_title")}</h2><p>{t("notification.push_hint")}</p>
  {supported===false?<p>{t("notification.push_unsupported")}</p>:state?<>
   <button disabled={busy} onClick={()=>void action(state.enabled?"DISABLE":"ENABLE")}>{t(state.enabled?"notification.push_disable":"notification.push_enable")}</button>
   {state.enabled?<label><input type="checkbox" checked={state.infoOptIn} disabled={busy} onChange={e=>void action("INFO",e.target.checked)}/>{t("notification.push_info")}</label>:null}
  </>:<p>{t("auth.checking")}</p>}<p role="status">{busy?t("auth.checking"):message}</p>
 </section>;
}

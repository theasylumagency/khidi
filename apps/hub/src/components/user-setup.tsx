"use client";
import { useEffect,useRef,useState,type FormEvent } from "react";
import { t } from "@khidi/i18n";
import { OfficeLoginForm } from "./office-login-form.tsx";
import { logoutSession } from "../lib/session-client.ts";
type Preview={kind:string;fullName:string;email:string|null};
export function UserSetup({sessionId,registeredDevice}:{sessionId?:string;registeredDevice:boolean}) {
 const fragmentToken=useRef<string|null>(null);
 const [token,setToken]=useState(""),[preview,setPreview]=useState<Preview|null>(null),[secret,setSecret]=useState(""),[confirm,setConfirm]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[credentials,setCredentials]=useState<{email:string;password:string}|null>(null);
 useEffect(()=>{
  const value=fragmentToken.current??new URLSearchParams(window.location.hash.slice(1)).get("setup")??"";
  fragmentToken.current=value;
  window.history.replaceState(null,"","/login?setup=1");setToken(value);
  if(sessionId)return;
  let active=true;const controller=new AbortController();
  void fetch("/api/auth/setup",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",redirect:"error",signal:controller.signal,body:JSON.stringify({action:"INSPECT",token:value})})
   .then(async response=>{if(!response.ok)throw new Error();const body=await response.json();if(active)setPreview(body);}).catch(()=>{if(active)setMessage(t("users.setup_failed"));});
  return ()=>{active=false;controller.abort();};
 },[sessionId]);
 async function submit(event:FormEvent) {
  event.preventDefault();if(busy)return;if(secret!==confirm){setMessage(t("users.secret_mismatch"));return;}setBusy(true);setMessage("");
  try {
   const response=await fetch("/api/auth/setup",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",redirect:"error",body:JSON.stringify({action:"COMPLETE",token,secret})}),body=await response.json();
   if(!response.ok){setMessage(body.message??t("users.setup_failed"));return;}
   if(body.kind==="OFFICE")setCredentials({email:body.email,password:secret});
   setSecret("");setConfirm("");setToken("");setDone(true);
  }catch{setMessage(t("auth.network_error"));}finally{setBusy(false);}
 }
 if(sessionId)return <section><h1>{t("users.setup_title")}</h1><p>{t("users.signout_first")}</p><button disabled={!token||busy} onClick={()=>{setBusy(true);void logoutSession(sessionId,token).catch(()=>{setMessage(t("auth.network_error"));setBusy(false);});}}>{t("auth.logout")}</button><p role="status">{message}</p></section>;
 if(credentials)return <section><p>{t("users.enroll_next")}</p><OfficeLoginForm beforeLogin={async()=>{navigator.serviceWorker?.controller?.postMessage({type:"CLEAR_AUTH_CACHES"});}} initialCredentials={credentials} passkeysAllowed={!registeredDevice}/></section>;
 if(done)return <section><p>{t("users.setup_done")}</p><a href="/login">{t("auth.sign_in")}</a></section>;
 return <section className="office-login"><h1>{t("users.setup_title")}</h1>{message?<p role="alert">{message}</p>:null}
  {!preview?(message?<p>{t("users.resume_hint")} <a href="/login">{t("auth.password_sign_in")}</a></p>:<p>{t("users.loading")}</p>):<><h2>{preview.fullName}</h2><p>{t("users.setup_help")}</p>{preview.kind==="WAREHOUSE"&&!registeredDevice?<p>{t("users.pin_device")}</p>:<form onSubmit={submit}><fieldset disabled={busy}>
   {preview.kind==="OFFICE"?<label>{t("auth.email")}<input type="email" name="username" autoComplete="username" readOnly value={preview.email??""}/></label>:null}
   <label>{t(preview.kind==="OFFICE"?"auth.password":"auth.pin_code")}<input type="password" name="newSecret" autoComplete={preview.kind==="OFFICE"?"new-password":"off"} inputMode={preview.kind==="WAREHOUSE"?"numeric":"text"} autoCapitalize="none" autoCorrect="off" spellCheck={false} minLength={preview.kind==="OFFICE"?12:4} maxLength={preview.kind==="OFFICE"?72:6} pattern={preview.kind==="WAREHOUSE"?"[0-9]{4,6}":undefined} required value={secret} onChange={e=>setSecret(e.target.value)}/></label>
   <label>{t("users.confirm_secret")}<input type="password" name="confirmSecret" autoComplete={preview.kind==="OFFICE"?"new-password":"off"} inputMode={preview.kind==="WAREHOUSE"?"numeric":"text"} autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={72} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
   <button>{t("users.activate")}</button>
  </fieldset></form>}</>}
 </section>;
}

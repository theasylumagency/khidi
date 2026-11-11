"use client";
import { Fragment,useRef,useState,type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t,type TranslationKey } from "@khidi/i18n";
import type { UserRole,GranularPermission } from "@khidi/shared";
import { StrongReauthentication } from "./strong-reauthentication.tsx";
import { createUserCommandSender } from "../lib/user-management-client.ts";

type User={id:string;fullName:string;email:string|null;role:UserRole;active:boolean;entityIds:string[];permissions:GranularPermission[];setupPending:boolean;totpEnrollmentRequired:boolean};
type Entity={id:string;key:string};
type Fields={fullName:string;email:string|null;role:UserRole;entityIds:string[];permissions:GranularPermission[]};
function UserEditor({user,entities,roles,permissions,busy,self,onSave}:{user?:User;entities:Entity[];roles:UserRole[];permissions:GranularPermission[];busy:boolean;self:boolean;onSave(fields:Fields):void}) {
 const [role,setRole]=useState<UserRole>(user?.role??"OPERATOR");
 function save(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=new FormData(e.currentTarget);onSave({fullName:String(data.get("fullName")),email:role==="WAREHOUSE"?null:String(data.get("email")),role,entityIds:data.getAll("entityIds").map(String),permissions:role==="WAREHOUSE"?[]:data.getAll("permissions").map(String) as GranularPermission[]});}
 return <form onSubmit={save}><fieldset disabled={busy} style={{display:"grid",gap:".75rem"}}>
  <label>{t("users.name")}<input name="fullName" required maxLength={200} defaultValue={user?.fullName}/></label>
  <label>{t("users.role")}<select value={role} disabled={self} onChange={e=>setRole(e.target.value as UserRole)}>{roles.map(r=><option key={r} value={r}>{t(`scanning.role.${r}`)}</option>)}</select></label>
  {role!=="WAREHOUSE"?<label>{t("auth.email")}<input name="email" type="email" autoCapitalize="none" autoCorrect="off" maxLength={254} required defaultValue={user?.email??""}/></label>:null}
  <fieldset><legend>{t("users.entities")}</legend>{entities.map(entity=><label key={entity.id}><input type="checkbox" name="entityIds" value={entity.id} defaultChecked={user?.entityIds.includes(entity.id)}/>{entity.key}</label>)}</fieldset>
  {role!=="WAREHOUSE"?<fieldset><legend>{t("users.permissions")}</legend>{permissions.map(permission=><label key={permission}><input type="checkbox" name="permissions" value={permission} defaultChecked={user?.permissions.includes(permission)}/>{t(`users.permission.${permission}` as TranslationKey)}</label>)}</fieldset>:null}
  <button>{t(user?"users.save":"users.create")}</button>
 </fieldset></form>;
}
export function UserManagement({users,entities,roles,permissions,selfId,hours,sharedDevice}:{users:User[];entities:Entity[];roles:UserRole[];permissions:GranularPermission[];selfId:string;hours:number;sharedDevice:boolean}) {
 const sender=useRef<ReturnType<typeof createUserCommandSender>|null>(null);
 const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[reauth,setReauth]=useState(false),[setupUrl,setSetupUrl]=useState(""),[editing,setEditing]=useState<string|null>(null),[ttl,setTtl]=useState(hours);
 async function command(input:unknown) {
  if(busy)return;setBusy(true);setMessage("");setSetupUrl("");
  try {
   sender.current??=createUserCommandSender();
   const {response,body}=await sender.current(input);
   if(response.status===428){setReauth(true);return;}if(!response.ok){setMessage(body.error??t("users.failed"));return;}
   setEditing(null);setSetupUrl(body.setupUrl??"");setMessage(t("users.saved"));router.refresh();
  }catch{setMessage(t("users.failed"));}finally{setBusy(false);}
 }
 return <section style={{display:"grid",gap:"1rem"}}><h1>{t("users.title")}</h1><p>{t("users.help")}</p>
  {reauth?<StrongReauthentication sharedDevice={sharedDevice} onSuccess={()=>{setReauth(false);setMessage(t("users.retry"));}}/>:null}
  {message?<p role="status">{message}</p>:null}
  {setupUrl?<aside role="status"><h2>{t("users.setup_link")}</h2><p>{t("users.link_help")}</p><textarea aria-label={t("users.setup_link")} readOnly value={setupUrl} rows={3}/><button type="button" onClick={()=>void navigator.clipboard.writeText(setupUrl).then(()=>setMessage(t("users.copied"))).catch(()=>setMessage(t("auth.copy_failed")))}>{t("users.copy")}</button><button type="button" onClick={()=>setSetupUrl("")}>{t("users.close_link")}</button></aside>:null}
  <details><summary>{t("users.create")}</summary><UserEditor entities={entities} roles={roles} permissions={permissions} busy={busy} self={false} onSave={fields=>void command({action:"CREATE",...fields})}/></details>
  <form onSubmit={e=>{e.preventDefault();void command({action:"TTL",hours:ttl});}}><label>{t("users.ttl")}<input type="number" min={1} step={1} required value={ttl} onChange={e=>setTtl(Number(e.target.value))}/></label><button disabled={busy}>{t("users.save")}</button></form>
  <div style={{overflowX:"auto"}}><table><thead><tr>{["users.name","auth.email","users.role","users.entities","users.status","users.actions"].map(key=><th key={key}>{t(key as TranslationKey)}</th>)}</tr></thead><tbody>
   {users.map(user=><Fragment key={user.id}><tr><td>{user.fullName}</td><td>{user.email??"—"}</td><td>{t(`scanning.role.${user.role}`)}</td><td>{entities.filter(e=>user.entityIds.includes(e.id)).map(e=>e.key).join(", ")}</td><td>{t(!user.active?"users.inactive":user.setupPending?"users.pending":user.totpEnrollmentRequired?"users.totp_pending":"users.active")}</td><td>
    <button type="button" disabled={busy} onClick={()=>setEditing(editing===user.id?null:user.id)}>{t("users.edit")}</button>
    <button type="button" disabled={busy||user.id===selfId} onClick={()=>{if(window.confirm(t(user.active?"users.confirm_deactivate":"users.confirm_reactivate")))void command({action:"ACTIVE",id:user.id,active:!user.active});}}>{t(user.active?"users.deactivate":"users.reactivate")}</button>
    {user.active?<button type="button" disabled={busy||user.id===selfId} onClick={()=>{if(user.setupPending||window.confirm(t("users.confirm_reset")))void command({action:user.setupPending?"ISSUE":"RESET",id:user.id});}}>{t(user.setupPending?"users.reissue":"users.reset")}</button>:null}
   </td></tr>{editing===user.id?<tr><td colSpan={6}><UserEditor user={user} entities={entities} roles={roles} permissions={permissions} busy={busy} self={user.id===selfId} onSave={fields=>void command({action:"EDIT",id:user.id,...fields})}/></td></tr>:null}</Fragment>)}
  </tbody></table></div>
 </section>;
}

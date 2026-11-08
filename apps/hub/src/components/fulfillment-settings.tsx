"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type TranslationKey } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import { StrongReauthentication } from "./strong-reauthentication.tsx";
import { fulfillmentPost, FulfillmentActionError } from "./fulfillment-client.ts";
type Store={id:string;name:string;webhookUrl:string|null};
type Key={id:string;storefrontId:string;name:string;keyPrefix:string;active:boolean;allowedIps:string[]|null;rateLimitPerMinute:number;expiresAt:string|null;lastUsedAt:string|null};
type Delivery={id:string;consumer:string;status:string;attempts:number;lastErrorCode:string|null;eventType:string};
export function FulfillmentSettings({mode,stores,keys,deliveries}:{mode:string;stores:Store[];keys:Key[];deliveries:Delivery[]}) {
  const router=useRouter(),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[secret,setSecret]=useState(""),[reauth,setReauth]=useState(false),[pending,setPending]=useState<{url:string;input:unknown;key:string}|null>(null);
  const [storeId,setStoreId]=useState(stores[0]?.id??""),[chosenMode,setChosenMode]=useState(mode);
  async function run(url:string,input:unknown,key=createUuidV7()) {
    setBusy(true);setNotice("");setSecret("");setReauth(false);setPending({url,input,key});
    try{const body=await fulfillmentPost(url,input,key);setSecret(String(body.rawApiKey??body.secret??""));setNotice(t("inventory.saved"));setPending(null);router.refresh();}
    catch(e){setNotice(e instanceof Error ? e.message : t("scanning.error"));setReauth(e instanceof FulfillmentActionError&&e.code==="RECENT_AUTH_REQUIRED");}finally{setBusy(false);}
  }
  const storeName=(id:string)=>stores.find((s)=>s.id===id)?.name??id;
  return <section className="fulfillment-settings"><h2>{t("fulfillment.settings")}</h2>
    <form onSubmit={(e)=>{e.preventDefault();void run("/api/fulfillment",{action:"mode",input:{mode:chosenMode}});}}>
      <label>{t("fulfillment.mode")}<select disabled={busy} value={chosenMode} onChange={(e)=>setChosenMode(e.target.value)}>{["SIMPLIFIED_FULFILLMENT","CONTROLLED_FULFILLMENT"].map((m)=><option key={m} value={m}>{t(("fulfillment."+m) as TranslationKey)}</option>)}</select></label>
      <p>{t("fulfillment.mode_hint")}</p><button disabled={busy||chosenMode===mode}>{t("fulfillment.save_mode")}</button>
    </form>
    <h3>{t("fulfillment.service_keys")}</h3><p>{t("fulfillment.secret_hint")}</p>
    <form onSubmit={(e)=>{e.preventDefault();const data=new FormData(e.currentTarget);void run("/api/storefront-keys",{action:"ISSUE",storefrontId:storeId,name:String(data.get("name")),allowedIps:String(data.get("ips")??"").split(/[\s,]+/).filter(Boolean),
      rateLimitPerMinute:Number(data.get("rate")),...(data.get("expires") ? {expiresAt:new Date(String(data.get("expires"))+":00+04:00").toISOString()} : {})});}}>
      <fieldset disabled={busy||!stores.length}><label>{t("inventory.store")}<select value={storeId} onChange={(e)=>setStoreId(e.target.value)}>{stores.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>{t("fulfillment.key_name")}<input name="name" required maxLength={100} autoComplete="off"/></label>
        <label>{t("fulfillment.allowed_ips")}<input name="ips" autoComplete="off" placeholder={t("fulfillment.ips_hint")}/></label>
        <label>{t("fulfillment.rate")}<input name="rate" type="number" min={1} max={10000} defaultValue={120} required/></label>
        <label>{t("fulfillment.expires_tbilisi")}<input name="expires" type="datetime-local"/></label><button>{t("fulfillment.issue_key")}</button>
      </fieldset>
    </form>
    <div className="inventory-scroll"><table><thead><tr>{["store","key_name","prefix","rate","expires","last_used","actions"].map((k)=><th key={k}>{t(("fulfillment."+k) as TranslationKey)}</th>)}</tr></thead><tbody>{keys.map((k)=><tr key={k.id}>
      <td>{storeName(k.storefrontId)}</td><td>{k.name} · {t(k.active?"fulfillment.active":"fulfillment.revoked")}</td><td><code>{k.keyPrefix}</code></td><td>{k.rateLimitPerMinute}</td><td>{date(k.expiresAt)}</td><td>{date(k.lastUsedAt)}</td><td>{k.active?<>
        <button disabled={busy} onClick={()=>void run("/api/storefront-keys",{action:"ROTATE",keyId:k.id,name:k.name,allowedIps:k.allowedIps??[],rateLimitPerMinute:k.rateLimitPerMinute,...(k.expiresAt?{expiresAt:k.expiresAt}:{})})}>{t("fulfillment.rotate")}</button>{" "}
        <button disabled={busy} onClick={()=>void run("/api/storefront-keys",{action:"REVOKE",keyId:k.id})}>{t("fulfillment.revoke")}</button></>:null}</td>
    </tr>)}</tbody></table></div>
    <h3>{t("fulfillment.webhooks")}</h3>
    {stores.map((s)=><form key={s.id+":"+s.webhookUrl} onSubmit={(e)=>{e.preventDefault();const data=new FormData(e.currentTarget);void run("/api/fulfillment",{action:"webhook",input:{storefrontId:s.id,url:String(data.get("url")??"").trim()||null,rotateSecret:data.has("rotate")}});}}>
      <fieldset disabled={busy}><legend>{s.name}</legend><label>{t("fulfillment.webhook_url")}<input name="url" type="url" maxLength={2048} defaultValue={s.webhookUrl??""} autoComplete="off"/></label>
        <label><input name="rotate" type="checkbox"/>{t("fulfillment.rotate_secret")}</label><button>{t("inventory.confirm")}</button></fieldset>
    </form>)}
    <div className="inventory-scroll"><table><thead><tr>{["store","event","status","attempts","actions"].map((k)=><th key={k}>{t(("fulfillment."+k) as TranslationKey)}</th>)}</tr></thead><tbody>{deliveries.map((d)=><tr key={d.id}>
      <td>{storeName(d.consumer.slice("storefront:".length))}</td><td><code>{d.eventType}</code></td><td>{t(("fulfillment."+d.status) as TranslationKey)}{d.lastErrorCode?<small> · {t("fulfillment.delivery_failed")}</small>:null}</td><td>{d.attempts}</td>
      <td>{d.status==="DEAD_LETTER"?<button disabled={busy} onClick={()=>void run("/api/fulfillment",{action:"retry-webhook",input:{deliveryId:d.id}})}>{t("fulfillment.retry")}</button>:null}</td>
    </tr>)}</tbody></table></div>
    <p role="status">{busy?t("auth.checking"):notice}</p>{reauth?<StrongReauthentication onSuccess={()=>setReauth(false)}/>:null}
    {pending&&!busy?<button onClick={()=>void run(pending.url,pending.input,pending.key)}>{t("fulfillment.retry")}</button>:null}
    {secret?<section><h3>{t("fulfillment.copy_secret")}</h3><p>{t("fulfillment.secret_hint")}</p><textarea aria-label={t("fulfillment.copy_secret")} readOnly value={secret} autoComplete="off" spellCheck={false}/><button onClick={()=>setSecret("")}>{t("fulfillment.hide_secret")}</button></section>:null}
  </section>;
}
const formatter=new Intl.DateTimeFormat("ka-GE",{timeZone:"Asia/Tbilisi",dateStyle:"short",timeStyle:"short",hourCycle:"h23"});
function date(raw:string|null){return raw?formatter.format(new Date(raw)):"—";}

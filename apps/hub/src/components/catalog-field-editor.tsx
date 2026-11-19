"use client";
import { useState } from "react";
import { t } from "@khidi/i18n";
import { relationKinds, sameValues, type FieldKey, type Assessments } from "@khidi/catalog-review/fields";

export function FieldEditor({field, entry, original, peers, photos, invalid, onChange}:{
  field:FieldKey;entry:Assessments[FieldKey];original:string[];peers:{wp:number;name:string}[];
  photos:{id:string;position:number;url:string}[];invalid:boolean;onChange:(entry:Assessments[FieldKey])=>void;
}) {
  const [newRow,setNewRow]=useState(""), [kind,setKind]=useState<typeof relationKinds[number]>("compare");
  const single=field==="name" || field==="description";
  const inactive=entry.verdict==="UNNEEDED", values=entry.value;
  const setValues=(value:string[])=>onChange({...entry,value,verdict:sameValues(original,value) ? "" : "EDIT"});
  function move(i:number,by:number) { const next=[...values]; next.splice(i+by,0,...next.splice(i,1)); setValues(next); }
  function label(v:string) {
    if(field==="photos") return t("review.photo")+" "+(photos.find(p=>p.id===v)?.position ?? v);
    if(field==="links") { const [k,wp]=v.split(":"); return t(`pilot.relation.${k as typeof kind}`)+" · "+(peers.find(p=>String(p.wp)===wp)?.name ?? "")+" #"+wp; }
    return v;
  }
  return <fieldset className="field-editor" aria-invalid={invalid} id={"field-"+field}>
    <legend>{t(`pilot.target.${field}`)}</legend>
    {!inactive && (single ? <textarea aria-label={t(`pilot.target.${field}`)} rows={field==="name"?2:4}
      maxLength={field==="name"?300:4000} value={values[0] ?? ""} onChange={e=>setValues(e.target.value?[e.target.value]:[])}/> :
      <><ol className="field-rows">{values.map((v,i)=><li key={i}>
        {field==="photos" && <img src={photos.find(p=>p.id===v)?.url} alt={label(v)} width={64} height={64}/>}
        {field==="facts" || field==="kit" ? <input aria-label={t(`pilot.target.${field}`)+" "+(i+1)} maxLength={300} value={v}
          onChange={e=>setValues(values.map((s,n)=>n===i?e.target.value:s))}/> : <span>{label(v)}</span>}
        <div className="field-tools">
          <button type="button" aria-label={t("fields.up")+" "+(i+1)} disabled={!i} onClick={()=>move(i,-1)}>↑</button>
          <button type="button" aria-label={t("fields.down")+" "+(i+1)} disabled={i===values.length-1} onClick={()=>move(i,1)}>↓</button>
          <button type="button" onClick={()=>setValues(values.filter((_,n)=>i!==n))}>{t("fields.remove")}</button>
        </div></li>)}</ol>
        {field==="photos" ? <>{!!values.length && <small>{t("fields.main")}</small>}
          <div className="pilot-gallery">{photos.filter(p=>!values.includes(p.id)).map(p=><button type="button" key={p.id}
            onClick={()=>setValues([...values,p.id])}><img src={p.url} alt={t("review.photo")+" "+p.position}/>{t("fields.photoAdd")} {p.position}</button>)}</div></> :
        field==="links" ? <div className="field-tools"><select aria-label={t("fields.type")} value={kind}
          onChange={e=>setKind(e.target.value as typeof kind)}>{relationKinds.map(k=><option key={k} value={k}>{t(`pilot.relation.${k}`)}</option>)}</select>
          <select value="" aria-label={t("fields.choose")} onChange={e=>setValues([...values,kind+":"+e.target.value])}>
            <option value="">{t("fields.choose")}</option>{peers.filter(p=>!values.some(v=>v.endsWith(":"+p.wp))).map(p=>
              <option key={p.wp} value={p.wp}>{p.name} · #{p.wp}</option>)}</select></div> :
        <div className="field-tools"><input aria-label={t("fields.newRow")} maxLength={300} value={newRow} onChange={e=>setNewRow(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(newRow.trim()){setValues([...values,newRow.trim()]);setNewRow("");}}}}/>
          <button type="button" disabled={!newRow.trim() || values.length>=32} onClick={()=>{setValues([...values,newRow.trim()]);setNewRow("");}}>{t("fields.rowAdd")}</button></div>}
      </>)}
    <div className="pilot-choices">{(["OK","EDIT","UNNEEDED"] as const).map(v=><label key={v}>
      <input type="radio" name={"verdict-"+field} checked={entry.verdict===v} disabled={v==="OK" && !inactive && !sameValues(values,original)}
        onChange={()=>onChange({...entry,verdict:v,value:v==="UNNEEDED"?[]:inactive?original:values,
          reason:v==="OK"?"":entry.reason,unknown:v==="UNNEEDED"?false:entry.unknown})}/>
      {t(v==="OK"?"fields.ok":v==="EDIT"?"fields.edit":"fields.unneeded")}</label>)}</div>
    {entry.verdict && entry.verdict!=="OK" && <label>{t("fields.why")}<input maxLength={600} value={entry.reason}
      onChange={e=>onChange({...entry,reason:e.target.value})}/></label>}
    {!inactive && <label><input type="checkbox" checked={entry.unknown} onChange={e=>onChange({...entry,unknown:e.target.checked})}/> {t("fields.unknown")}</label>}
    {(!sameValues(original,values) || inactive) && <details><summary>{t("fields.oldPrompt")}</summary><p>{original.map(label).join("\n") || "—"}</p>
      <button type="button" onClick={()=>onChange({value:original,verdict:"",reason:"",unknown:false})}>{t("fields.reset")}</button></details>}
    {invalid && <small role="alert">{t(!entry.verdict?"fields.enterVerdict":
      entry.verdict!=="OK" && !entry.reason.trim()?"fields.enterReason":entry.verdict==="EDIT" && sameValues(values,original)?"fields.sameEdit":
      values.some(v=>!v.trim())?"fields.finishRow":"fields.required")}</small>}
  </fieldset>;
}

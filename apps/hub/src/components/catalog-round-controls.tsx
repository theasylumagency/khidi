"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type TranslationKey } from "@khidi/i18n";
import { cardDefinition,roundQuestions,type CardDefinition } from "@khidi/catalog-review/fields";

export function RoundControls({round,mode,candidates=[]}:{round:number;mode:"survey"|"release"|"close";candidates?:{wp:number;name:string}[]}) {
  const router=useRouter(), [answers,setAnswers]=useState(["","",""]),[choice,setChoice]=useState(""),
    [note,setNote]=useState(""),[cards,setCards]=useState<CardDefinition[]>([]),[message,setMessage]=useState<TranslationKey>(),
    [busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false);
  const last=useRef({payload:"",key:""}), pending=useRef(false);
  function template() {
    const draft=candidates.slice(0,20).map(p=>({...p,type:"",description:"",facts:[],kit:[],links:[],questions:[]}));
    const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download="catalog-round-"+(round+1)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function load(file?:File) {
    setCards([]);setMessage(undefined);if (!file) return;
    try {if(file.size>500*1024) throw Error(); const parsed=cardDefinition.array().length(20).parse(JSON.parse(await file.text()));
      const ids=new Set(parsed.map(c=>c.wp));if(ids.size!==20 || parsed.some(c=>!candidates.some(p=>p.wp===c.wp) ||
        c.links.some(l=>l.wp===c.wp || !ids.has(l.wp)))) throw Error();setCards(parsed);
    } catch {setMessage("fields.invalidFile");}
  }
  async function send() {
    if (pending.current) return;
    const payload=JSON.stringify(mode==="survey"?{action:"SURVEY",round,answers}:mode==="close"?{action:"CLOSE",round,note}:{action:"OPEN",round,choice,note,cards});
    if (last.current.payload!==payload) last.current={payload,key:crypto.randomUUID()};
    pending.current=true;setBusy(true);
    try { const res=await fetch("/api/catalog-review/round",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":last.current.key},body:payload});
      if(!res.ok){setMessage(res.status===409?"review.conflict":res.status===400?"fields.invalidFile":"review.failed");return;}
      setMessage("fields.done");if(mode==="release") router.push("/review");router.refresh();
    } catch {setMessage("review.failed");} finally {pending.current=false;setBusy(false);}
  }
  return <form className="review-card pilot-form" onSubmit={e=>{e.preventDefault();void send();}}>
    <fieldset disabled={busy}><legend>{t(mode==="survey"?"fields.survey":mode==="close"?"fields.close":"fields.activate")}</legend>
      {mode==="close"?<><p>{t("fields.closeHelp")}</p>
        <label>{t("fields.closeNote")}<textarea required maxLength={1600} value={note} onChange={e=>setNote(e.target.value)}/></label>
        <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> {t("fields.closeConfirm")}</label></>:
      mode==="survey"?<><p>{t("fields.surveyOptional")}</p>{roundQuestions.map((q,i)=><label key={q}>{q}<textarea required maxLength={1600} value={answers[i]}
        onChange={e=>setAnswers(answers.map((a,n)=>n===i?e.target.value:a))}/></label>)}</>:<>
        <p>{t("fields.openHelp")}</p><details><summary>{t("fields.chooseAll")} ({candidates.length})</summary><ul>
          {candidates.map(p=><li key={p.wp}>#{p.wp} · {p.name}</li>)}</ul></details>
        <button type="button" onClick={template}>{t("fields.template")}</button>
        <label>{t("fields.load")}<input type="file" accept="application/json,.json" onChange={e=>void load(e.target.files?.[0])}/></label>
        {!!cards.length && <details><summary>{t("fields.round")} · {cards.length}</summary><ol>{cards.map(c=><li key={c.wp}>#{c.wp} · {c.name}</li>)}</ol></details>}
        <label>{t("fields.verdict")}<select required value={choice} onChange={e=>setChoice(e.target.value)}><option value="">{t("fields.select")}</option>
          <option value="KEEP">{t("fields.keep")}</option><option value="CHANGE">{t("fields.change")}</option></select></label>
        <label>{t("fields.schemaNote")}<textarea required maxLength={1600} value={note} onChange={e=>setNote(e.target.value)}/></label></>}
      <button className="review-button pilot-primary" type="submit" disabled={busy || (mode==="survey"?answers.some(a=>!a.trim()):mode==="close"?!confirmed || !note.trim():cards.length!==20 || !choice || !note.trim())}>
        {t(mode==="survey"?"fields.sendSurvey":mode==="close"?"fields.closeSend":"fields.open")}</button></fieldset>{message && <p role="status">{t(message)}</p>}</form>;
}

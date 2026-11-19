"use client";

import { FieldEditor } from "./catalog-field-editor.tsx";
import { fieldKeys, fieldProblem, startReview, type FieldKey } from "@khidi/catalog-review/fields";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedbackResponse, PilotRow } from "@khidi/catalog-review";
import { t, type TranslationKey } from "@khidi/i18n";

export function CatalogFeedbackForm({ row, photos, next, peers }: {
  row: PilotRow; peers: {wp:number;name:string}[]; photos: { id: string; url: string; position: number }[]; next: string | null;
}) {
  const router = useRouter();
  const [response, setResponse] = useState<FeedbackResponse>(() => row.response ?? {
    fields: startReview(row.original),
    suggestion: typeof row.legacy?.fieldNote === "string" ? row.legacy.fieldNote : "",
    photoNote: typeof row.legacy?.photoNote === "string" ? row.legacy.photoNote : "",
    answers: row.card.questions.map((_,i) => {
      const a=Array.isArray(row.legacy?.answers)?row.legacy.answers[i]:undefined;
      return a && (a.state==="KNOWN" || a.state==="UNKNOWN") && typeof a.text==="string" && typeof a.source==="string"
        ? {state:a.state as "KNOWN"|"UNKNOWN",text:a.text,source:a.source} : {state:"",text:"",source:""};
    })
  });
  const [invalid,setInvalid]=useState<FieldKey[]>([]);
  const [revision, setRevision] = useState(row.revision);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<TranslationKey>();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const retry = useRef({ payload: "", key: "" });
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function update(patch: Partial<FeedbackResponse>) {
    setInvalid([]); setDirty(true); setMessage(undefined); setResponse(current => ({ ...current, ...patch }));
  }
  function answer(index: number, patch: Partial<FeedbackResponse["answers"][number]>) {
    update({ answers: response.answers.map((a, i) => i === index ? { ...a, ...patch } : a) });
  }
  async function save(submit: boolean) {
    if (saving.current) return;
    const errors=fieldKeys.filter(k=>fieldProblem(k,response.fields[k],row.original[k],submit));
    if (errors.length) { setInvalid(errors); setMessage("fields.required"); document.getElementById("field-"+errors[0])?.scrollIntoView({block:"center"}); return; }
    if (submit && response.answers.some(a=>!a.state || a.state==="KNOWN" && (!a.text.trim() || !a.source.trim()))) {setMessage("pilot.invalid");return;}
    saving.current = true; setBusy(true);
    const payload = JSON.stringify({ productId: row.id, revision, submit, response });
    if (retry.current.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
    try {
      const result = await fetch("/api/catalog-review/feedback", { method: "POST", headers: {
        "Content-Type": "application/json", "Idempotency-Key": retry.current.key }, body: payload });
      if (!result.ok) { setMessage(result.status === 409 ? "review.conflict" : result.status === 400 ? "pilot.invalid" : "review.failed"); return; }
      const data = await result.json() as { revision: number };
      setRevision(data.revision); setDirty(false); setMessage(submit ? "pilot.done" : "pilot.draftSaved");
      if (submit) router.push(next ? "/review/" + next : "/review");
      router.refresh();
    } catch { setMessage("review.failed"); }
    finally { setBusy(false); saving.current = false; }
  }
  return <form className="pilot-form" onSubmit={e => { e.preventDefault(); void save(true); }}>
    <fieldset disabled={busy}>
      <legend>{t("pilot.fields")}</legend><p>{t("fields.guide")}</p>
      {!!response.fields.facts.value.length && <p className="review-quiet"><strong>{t("fields.shortLine")}</strong><br/>{response.fields.facts.value.slice(0,2).join(" · ")}</p>}
      {fieldKeys.map(field=><FieldEditor key={field} field={field} entry={response.fields[field]} original={row.original[field]} photos={photos} peers={peers}
        invalid={invalid.includes(field)} onChange={entry=>update({fields:{...response.fields,[field]:entry}})}/>)}
      {!!row.card.questions.length && <h2>{t("pilot.questions")}</h2>}
      {row.card.questions.map((question, i) => {
        const a = response.answers[i]!;
        return <section key={question.field} className="pilot-question">
          <strong>{question.prompt}</strong>
          <div className="pilot-choices">{(["KNOWN","UNKNOWN"] as const).map(state => <label key={state}>
            <input type="radio" name={"question-" + i} checked={a.state === state} onChange={() => answer(i, state === "UNKNOWN" ? { state, text: "", source: "" } : { state })}/>
            {t(state === "KNOWN" ? "pilot.known" : "pilot.unknown")}</label>)}</div>
          {a.state === "KNOWN" && <><label>{t("pilot.answer")}<textarea maxLength={1600} rows={2} value={a.text}
            onChange={e => answer(i, { text: e.target.value })}/></label>
            <label>{t("pilot.basis")}<input maxLength={1600} list="pilot-sources" value={a.source} placeholder={t("pilot.basisHint")}
              onChange={e => answer(i, { source: e.target.value })}/></label></>}
          {a.state === "UNKNOWN" && <label>{t("pilot.missingEvidence")}<input maxLength={1600} value={a.text}
            onChange={e => answer(i, { text: e.target.value })}/></label>}
        </section>;
      })}
      <datalist id="pilot-sources">{(["plate","manual","box","experience"] as const).map(key =>
        <option key={key} value={t(`pilot.${key}`)}/>)}</datalist>
      <details className="review-source-notes"><summary>{t("pilot.suggestions")}</summary>
        <label>{t("pilot.fieldPrompt")}<textarea maxLength={1600} value={response.suggestion ?? ""} onChange={e=>update({suggestion:e.target.value})}/></label>
        <label>{t("pilot.photoNote")}<input maxLength={1600} value={response.photoNote ?? ""} onChange={e=>update({photoNote:e.target.value})}/></label></details>
      <p className="review-quiet">{t("pilot.finishHelp")}</p>
      <div className="review-actions"><button className="review-button" type="button" onClick={() => void save(false)}>{t("pilot.draftSave")}</button>
        <button className="review-button pilot-primary" type="submit">{t("pilot.finish")}</button></div>
    </fieldset><p role="status" aria-live="polite">{message ? t(message) : dirty ? t("pilot.leave") : ""}</p>
  </form>;
}

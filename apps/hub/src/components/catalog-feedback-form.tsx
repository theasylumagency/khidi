"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedbackResponse, PilotRow } from "@khidi/catalog-review";
import { t, type TranslationKey } from "@khidi/i18n";

export function CatalogFeedbackForm({ row, photos, next }: {
  row: PilotRow; photos: { id: string; url: string; position: number }[]; next: string | null;
}) {
  const router = useRouter();
  const [response, setResponse] = useState<FeedbackResponse>(() => row.response ?? {
    outcome: "", correction: "", targets: [], fieldChange: "", fieldNote: "", photoId: null, photoNote: "",
    answers: row.card.questions.map(() => ({ state: "", text: "", source: "" }))
  });
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
    setDirty(true); setMessage(undefined); setResponse(current => ({ ...current, ...patch }));
  }
  function answer(index: number, patch: Partial<FeedbackResponse["answers"][number]>) {
    update({ answers: response.answers.map((a, i) => i === index ? { ...a, ...patch } : a) });
  }
  async function save(submit: boolean) {
    if (saving.current) return;
    if (submit && (!response.outcome || (response.outcome === "CORRECT" && !response.correction.trim()) ||
      (response.fieldChange && !response.fieldNote.trim()) || response.answers.some(a => !a.state ||
        (a.state === "KNOWN" && (!a.text.trim() || !a.source.trim()))))) { setMessage("pilot.invalid"); return; }
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
      <legend>{t("pilot.questions")}</legend>
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
      <label>{t("pilot.outcome")}<select value={response.outcome} onChange={e => update({ outcome: e.target.value as FeedbackResponse["outcome"],
        ...(e.target.value === "OK" ? { correction: "", targets: [] } : {}) })}>
        <option value="">{t("pilot.choice")}</option>{(["OK","CORRECT","UNKNOWN"] as const).map(op =>
          <option key={op} value={op}>{t(`pilot.${op}`)}</option>)}</select></label>
      {response.outcome === "CORRECT" && <div className="pilot-choices">{(["name","facts","description","kit","links","photos"] as const).map(field =>
        <label key={field}><input type="checkbox" checked={response.targets.includes(field)} onChange={e => update({
          targets: e.target.checked ? [...response.targets,field] : response.targets.filter(f => f !== field) })}/>{t(`pilot.target.${field}`)}</label>)}</div>}
      {response.outcome && response.outcome !== "OK" && <label>{t("pilot.correction")}<textarea maxLength={1600}
        value={response.correction} onChange={e => update({ correction: e.target.value })}/></label>}
      {!!photos.length && <div><strong>{t("pilot.main")}</strong><div className="pilot-gallery">{photos.map(photo =>
        <label key={photo.id}><img loading="lazy" src={photo.url} alt={t("review.photo") + " " + photo.position}/>
          <span><input type="radio" name="photo" checked={response.photoId === photo.id} onChange={() => update({ photoId: photo.id })}/>
            {t("review.photo")} {photo.position}</span></label>)}</div></div>}
      <label>{t("pilot.photoNote")}<input maxLength={1600} value={response.photoNote} onChange={e => update({ photoNote: e.target.value })}/></label>
      <label>{t("pilot.fieldPrompt")}<select value={response.fieldChange} onChange={e => update({ fieldChange: e.target.value as FeedbackResponse["fieldChange"],
        ...(!e.target.value ? { fieldNote: "" } : {}) })}>
        <option value="">{t("pilot.noField")}</option>{(["ADD","CHANGE","REMOVE"] as const).map(op =>
          <option value={op} key={op}>{t(`pilot.${op}`)}</option>)}</select></label>
      {response.fieldChange && <label>{t("pilot.fieldNote")}<textarea maxLength={1600} value={response.fieldNote}
        onChange={e => update({ fieldNote: e.target.value })}/></label>}
      <p className="review-quiet">{t("pilot.finishHelp")}</p>
      <div className="review-actions"><button className="review-button" type="button" onClick={() => void save(false)}>{t("pilot.draftSave")}</button>
        <button className="review-button pilot-primary" type="submit">{t("pilot.finish")}</button></div>
    </fieldset><p role="status" aria-live="polite">{message ? t(message) : dirty ? t("pilot.leave") : ""}</p>
  </form>;
}

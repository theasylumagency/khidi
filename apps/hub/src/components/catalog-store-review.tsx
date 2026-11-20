"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedbackResponse, PilotRow } from "@khidi/catalog-review";
import { fieldKeys, fieldProblem, relationKinds, sameValues, shortLine, splitFact, startReview, storeSections,
  type Assessments, type FieldKey, type StoreLayout } from "@khidi/catalog-review/fields";
import { t, type TranslationKey } from "@khidi/i18n";

type Photo = { id: string; url: string; position: number; illustration: boolean };
type Peer = { wp: number; name: string; id: string };
type Section = (typeof storeSections)[number];
type Kind = (typeof relationKinds)[number];
const identityLabels = ["ბრენდი", "კოდი", "მოდელი", "წარმოშობა"];
const defaultLayout = (): StoreLayout => ({ order: [...storeSections], missing: "" });
const kindOf = (value: string) => relationKinds.find(k => value.startsWith(k + ":")) ?? "compare";

/** Read-only store page: the reviewer's version as a buyer would roughly see it. */
export function StorePreview({ row, values, layout, photos, peers, phone = false }: {
  row: PilotRow; values: Record<FieldKey, string[]>; layout?: StoreLayout; photos: Photo[]; peers: Peer[]; phone?: boolean;
}) {
  return <StoreFrame row={row} values={values} layout={layout ?? defaultLayout()} photos={photos} peers={peers} phone={phone}
    slot={() => null} editor={() => null}/>;
}

function StoreFrame({ row, values, layout, photos, peers, phone, slot, editor, reviewing = false }: {
  row: PilotRow; values: Record<FieldKey, string[]>; layout: StoreLayout; photos: Photo[]; peers: Peer[]; phone: boolean;
  slot: (field: FieldKey) => React.ReactNode; editor: (field: FieldKey) => React.ReactNode; reviewing?: boolean;
}) {
  const facts = values.facts.map(splitFact);
  const key = facts.filter(([k]) => !identityLabels.includes(k)).slice(0, 4);
  const brand = facts.find(([k]) => k === "ბრენდი")?.[1] ?? "";
  const code = facts.find(([k]) => k === "კოდი" || k === "მოდელი")?.[1] ?? "";
  const gallery = values.photos.map(id => photos.find(p => p.id === id)).filter((p): p is Photo => Boolean(p));
  const block = (field: FieldKey, body: React.ReactNode) => <div className="store-block" data-field={field}>
    {editor(field) ?? body}{slot(field)}</div>;
  const sections: Record<Section, React.ReactNode> = {
    description: block("description", values.description[0]
      ? <div className="store-description">{values.description[0].split(/\n+/).map((p, i) => <p key={i}>{p}</p>)}</div>
      : <p className="store-empty">{t("store.noDescription")}</p>),
    facts: block("facts", facts.length
      ? <table className="store-specs"><tbody>{facts.map(([k, v], i) => <tr key={i}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody></table>
      : <p className="store-empty">{t("store.noFacts")}</p>),
    kit: block("kit", values.kit.length ? <ul>{values.kit.map((v, i) => <li key={i}>{v}</li>)}</ul>
      : <p className="store-empty">{t("store.noKit")}</p>),
    links: block("links", values.links.length ? <div className="store-related">{values.links.map(v => {
      const wp = v.split(":")[1], peer = peers.find(p => String(p.wp) === wp);
      return <div key={v} className="store-related-card"><small>{t(`store.relation.${kindOf(v)}`)}{reviewing ? " · " + t("store.unconfirmed") : ""}</small>
        {peer ? <a href={"/review/" + peer.id}>{peer.name}</a> : <span>#{wp}</span>}</div>;
    })}</div> : <p className="store-empty">{t("store.noLinks")}</p>)
  };
  return <div className={"store-frame" + (phone ? " store-phone" : "")} aria-label={t("store.frame")}>
    <div className="store-bar"><strong>{t("store.name")}</strong><span className="store-search">{t("store.search")}</span><span>{t("store.cart")}</span></div>
    <p className="store-crumbs">{t("store.home")} › {row.card.type}</p>
    <div className="store-page">
      <div className="store-hero">
        {block("photos", gallery.length ? <div className="store-gallery">
          <img className="store-main" src={gallery[0]!.url} alt={values.name[0] ?? ""}/>
          <div className="store-thumbs">{gallery.map((p, i) => <span key={p.id} className={i ? "" : "is-main"}>
            <img src={p.url} alt={t("review.photo") + " " + p.position} loading="lazy"/>{p.illustration && <em>{t("store.illustration")}</em>}</span>)}</div>
        </div> : <div className="store-main store-nophoto">{t("store.noPhoto")}</div>)}
        <div className="store-buy">
          {block("name", <h2>{values.name[0] ?? ""}</h2>)}
          <p className="store-sub">{[brand, code].filter(Boolean).join(" · ")}</p>
          <p className="store-chips">{shortLine(row.card.type, values.facts).map((c, i) => <span key={i}>{c}</span>)}</p>
          <p className="store-price"><strong>— ₾</strong> <small>{t("store.price")}</small></p>
          <p className="store-cta"><span>{t("store.buy")}</span><span>{t("store.installment")}</span></p>
          {!!key.length && <ul className="store-keyfacts">{key.map(([k, v], i) => <li key={i}><b>{k}:</b> {v}</li>)}</ul>}
        </div>
      </div>
      {layout.order.map(s => <section key={s} className="store-section"><h3>{t(`store.section.${s}`)}</h3>{sections[s]}</section>)}
    </div>
  </div>;
}

function ValueEditor({ field, values, original, photos, peers, onChange }: {
  field: FieldKey; values: string[]; original: string[]; photos: Photo[]; peers: Peer[]; onChange: (v: string[]) => void;
}) {
  const [kind, setKind] = useState<Kind>("alternative");
  const move = (i: number, by: number) => { const next = [...values]; next.splice(i + by, 0, ...next.splice(i, 1)); onChange(next); };
  const tools = (i: number) => <span className="store-row-tools">
    <button type="button" aria-label={t("fields.up") + " " + (i + 1)} disabled={!i} onClick={() => move(i, -1)}>↑</button>
    <button type="button" aria-label={t("fields.down") + " " + (i + 1)} disabled={i === values.length - 1} onClick={() => move(i, 1)}>↓</button>
    <button type="button" onClick={() => onChange(values.filter((_, n) => n !== i))}>{t("fields.remove")}</button></span>;
  if (field === "name" || field === "description") return <textarea className="store-input" aria-label={t(`pilot.target.${field}`)}
    rows={field === "name" ? 2 : 7} maxLength={field === "name" ? 300 : 4000} value={values[0] ?? ""}
    onChange={e => onChange(e.target.value ? [e.target.value] : [])}/>;
  if (field === "facts") return <div className="store-rows">{values.map((v, i) => { const [k, val] = splitFact(v);
    const set = (a: string, b: string) => onChange(values.map((x, n) => n === i ? (a.trim() ? a.trim() + ": " : "") + b : x));
    return <div key={i} className="store-row store-pair">
      <input aria-label={t("store.label") + " " + (i + 1)} maxLength={120} value={k} onChange={e => set(e.target.value, val)}/>
      <input aria-label={t("store.value") + " " + (i + 1)} maxLength={180} value={val} onChange={e => set(k, e.target.value)}/>{tools(i)}</div>; })}
    <button type="button" disabled={values.length >= 32} onClick={() => onChange([...values, t("store.label") + ": "])}>{t("fields.rowAdd")}</button></div>;
  if (field === "kit") return <div className="store-rows">{values.map((v, i) => <div key={i} className="store-row">
    <input aria-label={t("pilot.target.kit") + " " + (i + 1)} maxLength={300} value={v} onChange={e => onChange(values.map((x, n) => n === i ? e.target.value : x))}/>
    {tools(i)}</div>)}
    <button type="button" disabled={values.length >= 32} onClick={() => onChange([...values, t("fields.newRow")])}>{t("fields.rowAdd")}</button></div>;
  if (field === "links") return <div className="store-rows">{values.map((v, i) => { const wp = v.split(":")[1];
    return <div key={v} className="store-row"><span>{t(`store.relation.${kindOf(v)}`)} · {peers.find(p => String(p.wp) === wp)?.name ?? "#" + wp}</span>{tools(i)}</div>; })}
    <div className="store-row"><select aria-label={t("fields.type")} value={kind} onChange={e => setKind(e.target.value as Kind)}>
      {relationKinds.filter(k => k !== "compare").map(k => <option key={k} value={k}>{t(`store.relation.${k}`)}</option>)}</select>
      <select aria-label={t("fields.choose")} value="" onChange={e => e.target.value && onChange([...values, kind + ":" + e.target.value])}>
        <option value="">{t("fields.choose")}</option>{peers.filter(p => !values.some(v => v.endsWith(":" + p.wp)))
          .map(p => <option key={p.wp} value={p.wp}>{p.name} · #{p.wp}</option>)}</select></div></div>;
  return <div className="store-rows">{values.map((id, i) => { const p = photos.find(x => x.id === id);
    return <div key={id} className="store-row"><img src={p?.url} alt="" width={64} height={64}/>
      <span>{t("review.photo")} {p?.position}{i ? "" : " · " + t("store.main")}{p?.illustration ? " · " + t("store.illustration") : ""}</span>{tools(i)}</div>; })}
    <div className="store-row">{photos.filter(p => !values.includes(p.id)).map(p => <button type="button" key={p.id} onClick={() => onChange([...values, p.id])}>
      <img src={p.url} alt="" width={48} height={48}/> {t("fields.photoAdd")} {p.position}</button>)}</div>
    {!sameValues(values, original) && photos.find(p => p.id === values[0])?.illustration && <small role="alert">{t("store.illustrationMain")}</small>}</div>;
}

export function CatalogStoreReview({ row, photos, peers, next, old }: {
  row: PilotRow; photos: Photo[]; peers: Peer[]; next: string | null; old: { name: string; short: string; full: string };
}) {
  const router = useRouter();
  const [response, setResponse] = useState<FeedbackResponse>(() => row.response
    ? { ...row.response, layout: row.response.layout ?? defaultLayout(), activeSeconds: row.response.activeSeconds ?? 0 }
    : { fields: startReview(row.original), layout: defaultLayout(), activeSeconds: 0,
      suggestion: typeof row.legacy?.fieldNote === "string" ? row.legacy.fieldNote : "",
      photoNote: typeof row.legacy?.photoNote === "string" ? row.legacy.photoNote : "",
      answers: row.card.questions.map((_, i) => {
        const a = Array.isArray(row.legacy?.answers) ? row.legacy.answers[i] as Record<string, unknown> | undefined : undefined;
        return a && (a.state === "KNOWN" || a.state === "UNKNOWN") && typeof a.text === "string" && typeof a.source === "string"
          ? { state: a.state, text: a.text, source: a.source } : { state: "" as const, text: "", source: "" };
      }) });
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const [buyer, setBuyer] = useState(false), [phone, setPhone] = useState(false), [tab, setTab] = useState<"questions" | "old">("questions");
  const [revision, setRevision] = useState(row.revision), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<TranslationKey>();
  const saving = useRef(false), retry = useRef({ payload: "", key: "" }), seconds = useRef(response.activeSeconds ?? 0);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") seconds.current += 5; }, 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const fields = response.fields, layout = response.layout ?? defaultLayout();
  const update = (patch: Partial<FeedbackResponse>) => { setDirty(true); setMessage(undefined); setResponse(c => ({ ...c, ...patch })); };
  const setField = (field: FieldKey, entry: Assessments[FieldKey]) => update({ fields: { ...fields, [field]: entry } });
  const setValues = (field: FieldKey, value: string[]) =>
    setField(field, { ...fields[field], value, verdict: sameValues(row.original[field], value) ? "" : "EDIT" });
  const values = Object.fromEntries(fieldKeys.map(k => [k, fields[k].value])) as Record<FieldKey, string[]>;
  const problems: TranslationKey[] = [];
  for (const k of fieldKeys) {
    const f = fields[k];
    if (!f.verdict) problems.push("store.rate"); else if (f.verdict !== "OK" && !f.reason.trim()) problems.push("store.needReason");
  }
  if (response.answers.some(a => !a.state || a.state === "KNOWN" && (!a.text.trim() || !a.source.trim()))) problems.push("store.answer");
  const firstProblem = fieldKeys.find(k => !fields[k].verdict || fields[k].verdict !== "OK" && !fields[k].reason.trim());

  function moveSection(s: Section, by: number) {
    const order = [...layout.order], i = order.indexOf(s), j = i + by;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    update({ layout: { ...layout, order } });
  }
  async function save(submit: boolean) {
    if (saving.current) return;
    const invalid = fieldKeys.filter(k => fieldProblem(k, fields[k], row.original[k], submit));
    if (invalid.length || submit && problems.length) {
      setMessage(invalid.length ? "fields.required" : problems[0]);
      document.querySelector(`[data-field="${invalid[0] ?? firstProblem ?? "name"}"]`)?.scrollIntoView({ block: "center" });
      return;
    }
    saving.current = true; setBusy(true); setEditing(null);
    const body = { ...response, activeSeconds: seconds.current };
    const payload = JSON.stringify({ productId: row.id, revision, submit, response: body });
    if (retry.current.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
    try {
      const result = await fetch("/api/catalog-review/feedback", { method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": retry.current.key }, body: payload });
      if (!result.ok) { setMessage(result.status === 409 ? "review.conflict" : result.status === 400 ? "pilot.invalid" : "review.failed"); return; }
      const data = await result.json() as { revision: number };
      setRevision(data.revision); setDirty(false); setMessage(submit ? "pilot.done" : "pilot.draftSaved");
      if (submit) router.push(next ? "/review/" + next : "/review");
      router.refresh();
    } catch { setMessage("review.failed"); } finally { setBusy(false); saving.current = false; }
  }
  const slot = (field: FieldKey) => {
    if (buyer) return null;
    const f = fields[field], changed = !sameValues(row.original[field], f.value), section = (storeSections as readonly string[]).includes(field);
    const pick = (verdict: "OK" | "UNNEEDED") => setField(field, f.verdict === verdict ? { ...f, verdict: "" }
      : { ...f, verdict, value: verdict === "UNNEEDED" ? [] : f.verdict === "UNNEEDED" ? row.original[field] : f.value,
        reason: verdict === "OK" ? "" : f.reason, unknown: verdict === "UNNEEDED" ? false : f.unknown });
    return <div className="store-strip">
      <strong>{t(`pilot.target.${field}`)}</strong>
      <button type="button" aria-pressed={f.verdict === "OK"} data-verdict="OK" disabled={changed} onClick={() => pick("OK")}>{t("store.ok")}</button>
      <button type="button" aria-pressed={f.verdict === "EDIT" || editing === field} data-verdict="EDIT"
        onClick={() => setEditing(editing === field ? null : field)}>{t(editing === field ? "store.close" : "store.edit")}</button>
      <button type="button" aria-pressed={f.verdict === "UNNEEDED"} data-verdict="UNNEEDED" onClick={() => pick("UNNEEDED")}>{t("store.unneeded")}</button>
      <button type="button" aria-pressed={f.unknown} data-verdict="UNKNOWN" disabled={f.verdict === "UNNEEDED"}
        onClick={() => setField(field, { ...f, unknown: !f.unknown })}>{t("store.unknown")}</button>
      {section && <span className="store-order">
        <button type="button" aria-label={t("store.sectionUp")} onClick={() => moveSection(field as Section, -1)}>↑</button>
        <button type="button" aria-label={t("store.sectionDown")} onClick={() => moveSection(field as Section, 1)}>↓</button></span>}
      {(f.verdict === "EDIT" || f.verdict === "UNNEEDED") && <input className="store-reason" maxLength={600} aria-invalid={!f.reason.trim()}
        aria-label={t(`pilot.target.${field}`) + ": " + t("fields.reason")} placeholder={t("store.reason")} value={f.reason}
        onChange={e => setField(field, { ...f, reason: e.target.value })}/>}
      {changed && f.verdict !== "UNNEEDED" && <details className="store-was"><summary>{t("fields.oldPrompt")}</summary>
        <p>{field === "photos" || field === "links" ? row.original[field].length : row.original[field].join("\n") || "—"}</p>
        <button type="button" onClick={() => setField(field, { value: row.original[field], verdict: "", reason: "", unknown: false })}>{t("fields.reset")}</button></details>}
    </div>;
  };
  const editor = (field: FieldKey) => !buyer && editing === field
    ? <ValueEditor field={field} values={fields[field].value} original={row.original[field]} photos={photos} peers={peers}
      onChange={v => setValues(field, v)}/> : null;

  return <div className={"store-review" + (buyer ? " is-buyer" : "")}>
    <div className="store-toolbar">
      <div role="group" aria-label={t("store.mode")}>
        <button type="button" aria-pressed={!buyer} onClick={() => setBuyer(false)}>{t("store.mode.review")}</button>
        <button type="button" aria-pressed={buyer} onClick={() => { setEditing(null); setBuyer(true); }}>{t("store.mode.buyer")}</button></div>
      <div role="group" aria-label={t("store.width")}>
        <button type="button" aria-pressed={!phone} onClick={() => setPhone(false)}>{t("store.width.desktop")}</button>
        <button type="button" aria-pressed={phone} onClick={() => setPhone(true)}>{t("store.width.phone")}</button></div>
    </div>
    <div className="store-layout">
      <div>
        <StoreFrame row={row} values={values} layout={layout} photos={photos} peers={peers} phone={phone} slot={slot} editor={editor} reviewing={!buyer}/>
        {!buyer && <div className="store-notes"><label className="store-missing">{t("store.missing")}<textarea maxLength={1600} value={layout.missing}
          onChange={e => update({ layout: { ...layout, missing: e.target.value } })}/></label>
          <label className="store-missing">{t("pilot.photoReview")}<textarea maxLength={1600} value={response.photoNote}
            onChange={e => update({ photoNote: e.target.value })}/></label>
          <label className="store-missing">{t("pilot.suggestions")}<textarea maxLength={1600} value={response.suggestion}
            onChange={e => update({ suggestion: e.target.value })}/></label></div>}
      </div>
      {!buyer && <aside className="store-rail">
        <section><h2>{t("store.status")}</h2><ul className="store-checklist">{fieldKeys.map(k => <li key={k}><span>{t(`pilot.target.${k}`)}</span>
          <span className="store-dots"><i data-v={fields[k].verdict || "none"}/>{fields[k].unknown && <i data-v="UNKNOWN"/>}</span></li>)}</ul>
          <p role="status" aria-live="polite">{message ? t(message) : problems[0] ? t(problems[0]) : t("store.ready")}</p>
          <div className="review-actions"><button className="review-button" type="button" disabled={busy} onClick={() => void save(false)}>{t("pilot.draftSave")}</button>
            <button className="review-button pilot-primary" type="button" disabled={busy || problems.length > 0} onClick={() => void save(true)}>{t("pilot.finish")}</button></div>
          {dirty && <small>{t("pilot.leave")}</small>}</section>
        <section><div role="tablist" className="store-tabs">
          <button type="button" role="tab" aria-selected={tab === "questions"} onClick={() => setTab("questions")}>{t("store.questions")} ({row.card.questions.length})</button>
          <button type="button" role="tab" aria-selected={tab === "old"} onClick={() => setTab("old")}>{t("store.old")}</button></div>
          {tab === "old" ? <div className="store-old">{[["pilot.target.name", old.name], ["review.field.SHORT", old.short], ["review.field.FULL", old.full]]
            .map(([k, v]) => <div key={k}><h3>{t(k as TranslationKey)}</h3><p>{v || "—"}</p></div>)}</div>
            : row.card.questions.map((q, i) => { const a = response.answers[i]!;
              const set = (patch: Partial<typeof a>) => update({ answers: response.answers.map((x, n) => n === i ? { ...x, ...patch } : x) });
              return <div key={i} className="store-question"><small>{q.field}</small><p>{q.prompt}</p>
                <div className="store-strip">{(["KNOWN", "UNKNOWN"] as const).map(s => <button key={s} type="button" aria-pressed={a.state === s} data-verdict={s === "KNOWN" ? "OK" : "UNKNOWN"}
                  onClick={() => set(a.state === s ? { state: "" } : s === "UNKNOWN" ? { state: s, source: "" } : { state: s })}>{t(s === "KNOWN" ? "pilot.known" : "pilot.unknown")}</button>)}</div>
                {a.state === "KNOWN" && <><textarea aria-label={t("pilot.answer")} maxLength={1600} rows={2} value={a.text} onChange={e => set({ text: e.target.value })}/>
                  <div className="store-strip">{(["plate", "manual", "box", "experience"] as const).map(s => <button key={s} type="button" data-verdict="EDIT"
                    aria-pressed={a.source === t(`pilot.${s}`)} onClick={() => set({ source: a.source === t(`pilot.${s}`) ? "" : t(`pilot.${s}`) })}>{t(`pilot.${s}`)}</button>)}</div></>}
                {a.state === "UNKNOWN" && <input aria-label={t("pilot.missingEvidence")} placeholder={t("pilot.missingEvidence")} maxLength={1600} value={a.text}
                  onChange={e => set({ text: e.target.value })}/>}
              </div>; })}
        </section>
      </aside>}
    </div>
  </div>;
}

import Link from "next/link";
import type { PilotRow,getReviewProduct,roundDetails } from "@khidi/catalog-review";
import { changes,fieldKeys,roundQuestions,relationKinds,type FieldKey,type Assessments } from "@khidi/catalog-review/fields";
import { t } from "@khidi/i18n";
import { CatalogStoreReview, StorePreview } from "./catalog-store-review.tsx";
import { RoundControls } from "./catalog-round-controls.tsx";
import { ReviewPhotoStudio,ReviewPhotoHistory } from "./review-photo-studio.tsx";
import { readyImageModels } from "../lib/review-image-methods.ts";
import { pilotDrafts } from "../lib/catalog-feedback-report.ts";

type Details=Awaited<ReturnType<typeof roundDetails>>;
function verdict(v:Assessments[FieldKey]["verdict"]) {return t(v==="OK"?"fields.ok":v==="EDIT"?"fields.edit":"fields.unneeded");}

export function PilotQueue({rows,details}:{rows:PilotRow[];details:Details}) {
  const done=rows.filter(r=>r.submitted).length, first=rows[0]!, closed=first.locked;
  const finished=done===20 || Boolean(details.closure);
  const next=closed ? undefined : rows.find(r=>!r.submitted && r.revision) ?? rows.find(r=>!r.submitted);
  return <section className="catalog-review pilot"><h1>{t("pilot.title")}</h1><p>{t("fields.round")} {first.round} · {t("pilot.progress")} {done} / 20</p>
    <progress value={done} max={20}/><div className="review-actions">{next && <Link className="review-button pilot-primary" href={"/review/"+next.id}>
      {t(done || next.revision?"pilot.resume":"pilot.begin")}</Link>}<Link href={"/review/results?round="+first.round}>{t("pilot.overview")}</Link></div>
    {closed && details.closure && <p className="pilot-notice">{t("pilot.closed")}</p>}
    {finished && !details.decision && <><p className="pilot-notice">{t("fields.nextPending")}</p>{first.canWrite && !details.survey && <RoundControls round={first.round} mode="survey"/>}</>}
    <ol className="pilot-queue">{rows.map(r=><li key={r.id}><Link href={"/review/"+r.id}><strong>{r.card.name}</strong><small>#{r.card.wp} ·
      {t(r.submitted?"pilot.done":r.revision?"pilot.draft":"pilot.new")}</small></Link></li>)}</ol></section>;
}
function DisplayValues({row,field,values}:{row:PilotRow;field:FieldKey;values:string[]}) {
  return <div className="field-values">{values.length?values.map((v,i)=>field==="photos"?
    <a key={i} href={`/api/catalog-review/photo/${row.id}/${v}`}><img src={`/api/catalog-review/photo/${row.id}/${v}`} loading="lazy" width={64} height={64}
      alt={t("review.photo")+" "+(i+1)}/></a>:<div key={i}>{field==="links"?[t(`pilot.relation.${relationKinds.find(k=>v.startsWith(k+":")) ?? "compare"}`),"#"+v.split(":")[1]].join(" · "):v}</div>):"—"}</div>;
}
function RecordedFeedback({row}:{row:PilotRow}) {
  const r=row.response;
  return <>{row.actor && <small>{row.actor} · {row.at?.toLocaleString("ka-GE",{timeZone:"Asia/Tbilisi"})}</small>}
    {row.legacy && <details><summary>{t("fields.legacy")}</summary><pre>{JSON.stringify(row.legacy,null,2)}</pre></details>}
    {r && <>{fieldKeys.map(k=>{
      const f=r.fields[k],diff=changes(k,row.original[k],f.value);
      return <section key={k} className="field-history"><h3>{t(`pilot.target.${k}`)} · {f.verdict && verdict(f.verdict)}</h3>
        <dl><dt>{t("fields.original")}</dt><dd><DisplayValues field={k} row={row} values={row.original[k]}/></dd>
          <dt>{t("fields.final")}</dt><dd><DisplayValues field={k} row={row} values={f.value}/></dd>
          {(["removed","added","moved"] as const).filter(key=>diff[key].length).map(key=><div key={key}><dt>{t(`fields.${key}`)}</dt><dd>{diff[key].join(" · ")}</dd></div>)}</dl>
        {f.reason && <p>{f.reason}</p>}{f.unknown && <strong>{t("fields.unknown")}</strong>}</section>;})}
      {r.suggestion && <p><strong>{t("pilot.suggestions")}</strong> · {r.suggestion}</p>}
      {r.photoNote && <p><strong>{t("pilot.photoReview")}</strong> · {r.photoNote}</p>}
      {row.card.questions.map((q,i)=><p key={i}><strong>{q.prompt}</strong><br/>{r.answers[i]?.state==="KNOWN"?r.answers[i]?.text:t("pilot.unknown")}
        {" · "}{r.answers[i]?.state==="KNOWN"?r.answers[i]?.source:r.answers[i]?.text}</p>)}</>}</>;
}
export function PilotProduct({row,rows,result}:{row:PilotRow;rows:PilotRow[];result:Awaited<ReturnType<typeof getReviewProduct>>}) {
  const photos=result.photos.map(p=>({id:p.id,position:p.position,url:`/api/catalog-review/photo/${row.id}/${p.id}`,kind:row.photoKinds[p.id] ?? "PHOTO" as const}));
  const canWrite=row.canWrite && !row.submitted && !row.locked, old=result.product.baseline, text=(k:string)=>String(old[k] ?? "");
  const peers=rows.filter(r=>r.id!==row.id).map(r=>({wp:r.card.wp,name:r.card.name,id:r.id}));
  const values=Object.fromEntries(fieldKeys.map(k=>[k,row.response?.fields[k].value ?? row.original[k]])) as Record<FieldKey,string[]>;
  return <article className="catalog-review pilot"><Link href="/review">← {t("pilot.back")}</Link>
    {row.locked && !row.submitted && <p className="pilot-notice">{t("pilot.closed")}</p>}
    <header><small>{t("fields.round")} {row.round} · {row.position} / 20 · #{row.card.wp}</small><h1>{row.response?.fields.name.value[0] ?? row.card.name}</h1></header>
    <details className="review-source-notes"><summary>{t("pilot.source")}</summary>{["არსებული სახელი","არსებული მოკლე აღწერა","არსებული სრული აღწერა"].map(k=>
      old[k]?<p className="pilot-original" key={k}>{String(old[k])}</p>:null)}</details>
    {!!row.card.links.length && <details className="review-source-notes"><summary>{t("pilot.peers")}</summary><p>{t("pilot.peerHelp")}</p>
      {row.card.links.map(l=>{const peer=rows.find(p=>p.card.wp===l.wp);return peer && <div key={l.wp}><strong>{peer.card.name} · #{l.wp}</strong>
        <p>{t(`pilot.relation.${l.kind}`)} · {peer.card.facts.join(" · ")}</p></div>;})}</details>}
    {canWrite?<>{row.legacy && <RecordedFeedback row={row}/>}<CatalogStoreReview key={row.id} row={row} photos={photos} peers={peers}
      next={rows.find(r=>!r.submitted && r.id!==row.id)?.id ?? null}
      old={{name:text("არსებული სახელი"),short:text("არსებული მოკლე აღწერა"),full:text("არსებული სრული აღწერა")}}
      studio={<ReviewPhotoStudio productId={row.id} photos={photos} activity={result.photoWork} ready={readyImageModels()}/>}/></>:<>
      <StorePreview row={row} values={values} layout={row.response?.layout} photos={photos} peers={peers}/>
      {row.response?.layout?.missing && <p><strong>{t("store.missing")}</strong> · {row.response.layout.missing}</p>}<RecordedFeedback row={row}/></>}
    <ReviewPhotoHistory activity={result.photoWork}/></article>;
}

export function PilotResults({rows,details,admin,candidates,type,current}:{rows:PilotRow[];details:Details;admin:boolean;
  candidates:{wp:number;name:string}[];type?:string;current:number}) {
  const first=rows[0];if(!first) return <p>{t("pilot.none")}</p>;
  const completed=rows.filter(r=>r.submitted), subset=completed.filter(r=>!type || r.card.type===type);
  const drafts=pilotDrafts(rows).filter(r=>!type || r.card.type===type);
  const closure=details.closure, finished=completed.length===20 || Boolean(closure);
  return <section className="catalog-review pilot"><Link href="/review">← {t("pilot.back")}</Link><h1>{t("pilot.report")}</h1>
    <nav className="review-actions">{Array.from({length:current},(_,i)=><Link key={i} aria-current={i+1===first.round?"page":undefined}
      href={"/review/results?round="+(i+1)}>{t("fields.round")} {i+1}</Link>)}</nav><p>{t("pilot.progress")} · {completed.length} / 20</p>
    {closure && <p className="pilot-notice"><strong>{t("fields.closed")}</strong> · {closure.createdAt.toLocaleDateString("ka-GE",{timeZone:"Asia/Tbilisi"})}
      {" · "}{t("fields.closedCounts")}: {closure.submitted} / {closure.drafts} / {closure.untouched}<br/>{closure.note}</p>}
    <a className="review-button" href={"/api/catalog-review/results?round="+first.round}>{t("fields.download")}</a>
    <form className="review-actions"><input type="hidden" name="round" value={first.round}/><label>{t("fields.type")} <select name="type" defaultValue={type}>
      <option value="">{t("fields.byType")}</option>{[...new Set(rows.map(r=>r.card.type))].map(k=><option key={k}>{k}</option>)}</select></label>
      <button>{t("fields.select")}</button></form>
    <div className="field-table"><table><thead><tr>{["field","ok","edit","unneeded","emptyCount","missing"] .map(k=>
      <th key={k}>{t(`fields.${k as "field"|"ok"|"edit"|"unneeded"|"emptyCount"|"missing"}`)}</th>)}</tr></thead><tbody>
      {fieldKeys.map(k=>{const f=subset.flatMap(r=>r.response?[r.response.fields[k]]:[]);return <tr key={k}><th>{t(`pilot.target.${k}`)}</th>
        {["OK","EDIT","UNNEEDED"].map(v=><td key={v}>{f.filter(s=>s.verdict===v).length}</td>)}<td>{f.filter(s=>!s.value.length && s.verdict!=="UNNEEDED").length}</td>
        <td>{f.filter(s=>s.unknown).length}</td></tr>;})}</tbody></table></div>
    {details.survey && <section className="review-card"><h2>{t("fields.survey")}</h2>{roundQuestions.map((q,i)=><div key={q}><strong>{q}</strong><p>{details.survey!.answers[i]}</p></div>)}</section>}
    {details.decision?<p>{t(details.decision.choice==="KEEP"?"fields.keep":"fields.change")} · {details.decision.note}</p>:
      finished && admin?<RoundControls round={first.round} mode="release" candidates={candidates}/>:null}
    {finished && !details.survey && !details.decision && first.canWrite && <RoundControls round={first.round} mode="survey"/>}
    {admin && !finished && !details.decision && rows.length===20 && <RoundControls round={first.round} mode="close"/>}
    <h2>{t("pilot.summary")}</h2>{subset.map(r=><details key={r.id} className="review-source-notes"><summary>{r.card.name} · #{r.card.wp}</summary><RecordedFeedback row={r}/></details>)}
    {drafts.length>0 && <section className="pilot-drafts"><h2>{t("pilot.drafts")} · {drafts.length}</h2><p>{t("pilot.draftsHelp")}</p>
      {drafts.map(r=><details key={r.id} className="review-source-notes" data-draft="true"><summary>{r.card.name} · #{r.card.wp} · {t("pilot.draft")}</summary>
        <RecordedFeedback row={r}/></details>)}</section>}
  </section>;
}

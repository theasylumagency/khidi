import Link from "next/link";
import type { PilotRow, getReviewProduct } from "@khidi/catalog-review";
import { pilotRelation } from "@khidi/catalog-review";
import { t } from "@khidi/i18n";
import { CatalogFeedbackForm } from "./catalog-feedback-form.tsx";
import { ReviewPhotoStudio, ReviewPhotoHistory } from "./review-photo-studio.tsx";

export function PilotQueue({ rows }: { rows: PilotRow[] }) {
  const done = rows.filter(row => row.submitted).length;
  const next = rows.find(row => !row.submitted && row.revision) ?? rows.find(row => !row.submitted);
  return <section className="catalog-review pilot">
    <header><h1>{t("pilot.title")}</h1><p>{t("pilot.progress")} · {done} / 20</p><progress value={done} max={20}/></header>
    <p className="pilot-notice">{done === 20 ? t("pilot.paused") : t("pilot.hold")}</p>
    <div className="review-actions">{next && <Link className="review-button pilot-primary" href={"/review/" + next.id}>
      {t(done || next.revision ? "pilot.resume" : "pilot.begin")}</Link>}
      <Link href="/review/results">{t("pilot.overview")}</Link></div>
    <ol className="pilot-queue">{rows.map(row => <li key={row.id}>
      <Link href={"/review/" + row.id}><strong>{row.card.name}</strong><small>#{row.card.wp} · {t(row.submitted
        ? "pilot.done" : row.revision ? "pilot.draft" : "pilot.new")}</small></Link></li>)}</ol>
  </section>;
}

export function RecordedFeedback({ row }: { row: PilotRow }) {
  const r = row.response;
  if (!r) return null;
  return <div className="pilot-answers">
    {row.actor && <small>{t("pilot.author")} · {row.actor} · {row.at?.toLocaleString("ka-GE", { timeZone: "Asia/Tbilisi" })}</small>}
    {r.outcome && <p><strong>{t("pilot.reviewed")}</strong> · {t(`pilot.${r.outcome}`)} {r.targets.map(f => t(`pilot.target.${f}`)).join(", ")} {r.correction}</p>}
    {row.card.questions.map((q, i) => { const a = r.answers[i]; return <div key={q.field}><strong>{q.prompt}</strong>
      <p>{a?.state === "KNOWN" ? a.text : t(a?.state === "UNKNOWN" ? "pilot.unknown" : "pilot.new")}</p>
      {a?.state === "UNKNOWN" && a.text && <small>{a.text}</small>}
      {a?.state === "KNOWN" && <small>{t("pilot.evidence")} · {a.source}</small>}</div>; })}
    {r.fieldChange && <p><strong>{t("pilot.fields")} · {t(`pilot.${r.fieldChange}`)}</strong> {r.fieldNote}</p>}
    {r.photoNote && <p><strong>{t("pilot.photoReview")}</strong> · {r.photoNote}</p>}
    {r.photoId && <a href={`/api/catalog-review/photo/${row.id}/${r.photoId}`}>{t("pilot.photoSelected")}</a>}
  </div>;
}

export function PilotProduct({ row, rows, result }: {
  row: PilotRow; rows: PilotRow[]; result: Awaited<ReturnType<typeof getReviewProduct>>;
}) {
  const { card } = row;
  const photos = result.photos.map(p => ({ id: p.id, position: p.position, url: `/api/catalog-review/photo/${row.id}/${p.id}` }));
  const next = rows.find(r => !r.submitted && r.id !== row.id);
  const peers = rows.filter(r => card.peers.includes(r.card.wp) || r.card.peers.includes(card.wp));
  const old = result.product.baseline;
  const canWrite = row.canWrite && !row.submitted;
  return <article className="catalog-review pilot"><Link className="review-back" href="/review">← {t("pilot.back")}</Link>
    <header><small>{t("pilot.working")} {rows.findIndex(r => r.id === row.id) + 1} / 20 · #{card.wp}</small>
      <h1>{card.name}</h1></header>
    <section className="review-card pilot-summary">{photos[0] && <a href={photos[0].url} target="_blank" rel="noreferrer">
      <img src={photos[0].url} alt={card.name} width={132} height={132}/></a>}
      <div><p>{card.description}</p><ul>{card.facts.map(f => <li key={f}>{f}</li>)}</ul>
      {card.kit && <p><strong>{t("pilot.kit")}</strong> · {card.kit}</p>}</div></section>
    {!!peers.length && <details className="review-source-notes" open><summary>{t("pilot.peers")}</summary>
      <p className="review-quiet">{t("pilot.peerHelp")}</p><div className="pilot-peers">{peers.map(p =>
        <div key={p.id}><small>{t(`pilot.relation.${pilotRelation(card.wp,p.card.wp)}`)}</small>
          <p><strong>{p.card.name} · #{p.card.wp}</strong></p><p>{p.card.facts.join(" · ")}</p>
          {p.submitted && <details><summary>{t("pilot.answers")}</summary><RecordedFeedback row={p}/></details>}</div>)}</div></details>}
    <details className="review-source-notes"><summary>{t("pilot.source")}</summary>
      {["არსებული სახელი","არსებული მოკლე აღწერა","არსებული სრული აღწერა"].map(k => old[k] ?
        <p key={k} className="pilot-original">{String(old[k])}</p> : null)}
      {!old["არსებული სახელი"] && !old["არსებული მოკლე აღწერა"] && !old["არსებული სრული აღწერა"] && <p>{t("pilot.noSource")}</p>}
    </details>
    {canWrite ? <CatalogFeedbackForm key={row.id} row={row} photos={photos} next={next?.id ?? null}/>
      : <section className="review-card"><h2>{t(row.submitted ? "pilot.done" : "pilot.answers")}</h2><RecordedFeedback row={row}/></section>}
    {canWrite && <details className="review-source-notes"><summary>{t("pilot.photoTools")}</summary>
      <ReviewPhotoStudio productId={row.id} photos={photos} activity={result.photoWork} paid={Boolean(process.env.REVIEW_GEMINI_API_KEY)}/></details>}
    <ReviewPhotoHistory activity={result.photoWork}/>
  </article>;
}

export function PilotResults({ rows }: { rows: PilotRow[] }) {
  const completed = rows.filter(row => row.submitted);
  const counts = new Map<string, { known: number; unknown: number }>();
  for (const row of completed) row.card.questions.forEach((q, i) => {
    const n = counts.get(q.field) ?? { known: 0, unknown: 0 };
    if (row.response?.answers[i]?.state === "KNOWN") n.known++; else n.unknown++;
    counts.set(q.field, n);
  });
  return <section className="catalog-review pilot"><Link href="/review">← {t("pilot.back")}</Link><h1>{t("pilot.report")}</h1>
    <p>{t("pilot.progress")} · {completed.length} / 20</p>
    {completed.length === 20 && <p className="pilot-notice">{t("pilot.paused")} {t("pilot.waiting")}</p>}
    <section className="review-card"><h2>{t("pilot.remaining")}</h2>
    {counts.size ? <table><thead><tr><th>{t("pilot.questions")}</th><th>{t("pilot.known")}</th><th>{t("pilot.unknown")}</th></tr></thead>
      <tbody>{[...counts].sort((a,b) => b[1].unknown-a[1].unknown).map(([field,n]) =>
        <tr key={field}><td>{field}</td><td>{n.known}</td><td>{n.unknown}</td></tr>)}</tbody></table> : <p>{t("pilot.none")}</p>}</section>
    <section className="review-card"><h2>{t("pilot.suggestions")}</h2>
      {completed.some(r => r.response?.fieldChange) ? <ul>{completed.filter(r => r.response?.fieldChange).map(r =>
        <li key={r.id}><strong>#{r.card.wp} · {t(`pilot.${r.response!.fieldChange as "ADD"|"CHANGE"|"REMOVE"}`)}</strong> {r.response!.fieldNote}</li>)}</ul> : <p>{t("pilot.none")}</p>}</section>
    <h2>{t("pilot.summary")}</h2>{completed.map(row => <details key={row.id} className="review-source-notes">
      <summary>{row.card.name} · #{row.card.wp}</summary><RecordedFeedback row={row}/>
      <Link href={"/review/" + row.id}>{t("pilot.working")}</Link></details>)}
  </section>;
}

import type { PilotRow } from "@khidi/catalog-review";
import { changes, fieldKeys, roundQuestions } from "@khidi/catalog-review/fields";
import { t } from "@khidi/i18n";

/** Main photo kind as stored, with the reviewer's reason when she chose an illustration anyway. */
function mainPhoto(r:PilotRow) {
  const id=r.response?.fields.photos.value[0];
  if (!id) return "";
  const kind=r.photoKinds[id] ?? "PHOTO", reason=r.response?.mainPhoto?.photoId===id ? r.response.mainPhoto.reason : "";
  return t(`store.kind.${kind}`)+(reason ? ": "+reason : "");
}

/** Saved but unfinished cards. They are reported separately and never counted with submitted cards. */
export const pilotDrafts=(rows:PilotRow[])=>rows.filter(r=>!r.submitted && r.revision>0 && r.response);

function records(rows:PilotRow[]) {
  return rows.flatMap(r=>fieldKeys.map(k=>{
    const field=r.response?.fields[k], before=r.original[k], after=field?.value ?? [];
    const diff=field?changes(k,before,after):{added:[],removed:[],moved:[]};
    return [String(r.round),String(r.card.wp),r.card.type,r.card.name,k,t(`pilot.target.${k}`),before.join("\n"),after.join("\n"),
      field?.verdict?t(field.verdict==="OK"?"fields.ok":field.verdict==="EDIT"?"fields.edit":"fields.unneeded"):t("fields.legacy"),
      field?.reason ?? "",...([diff.removed,diff.added,diff.moved].map(v=>v.join("\n"))),
      field?t(field.unknown?"fields.yes":"fields.no"):"",field?t(after.length?"fields.no":"fields.yes"):"",
      r.card.questions.map((q,i)=>{const a=r.response?.answers[i]; return a?[q.prompt,t(a.state==="KNOWN"?"pilot.known":"pilot.unknown"),a.text,a.source].filter(Boolean).join(" · "):"";}).filter(Boolean).join("\n"),
      r.response?.suggestion ?? "",k==="photos"?r.response?.photoNote ?? "":"",r.actor ?? "",r.at?.toISOString() ?? "",String(r.revision),r.legacy ? JSON.stringify(r.legacy) : "",
      String(r.cardRevision),r.response?.layout ? r.response.layout.order.map(s=>t(`pilot.target.${s}`)).join(" → ") : "",r.response?.layout?.missing ?? "",
      r.response?.activeSeconds!==undefined ? String(Math.round(r.response.activeSeconds/60)) : "",mainPhoto(r)];
  }));
}

export function pilotReport(rows:PilotRow[],answers:string[]=[]) {
  const widths=[10,12,26,36,13,20,52,52,28,40,34,34,36,15,14,46,36,30,24,26,12,32,12,40,40,12,40],headers=[t("fields.round"),"WP ID",t("fields.type"),t("pilot.target.name"),t("fields.code"),
    t("fields.field"),t("fields.original"),t("fields.final"),t("fields.verdict"),t("fields.reason"),t("fields.removed"),
    t("fields.added"),t("fields.moved"),t("fields.missing"),t("fields.empty"),t("fields.evidence"),t("pilot.suggestions"),t("pilot.photoReview"),t("pilot.author"),"UTC",t("fields.revision"),t("fields.legacy"),
    t("fields.cardRevision"),t("fields.order"),t("fields.pageMissing"),t("fields.minutes"),t("fields.mainPhoto")];
  return [{name:t("fields.sheet"),widths,headers,rows:records(rows.filter(r=>r.submitted))},
    {name:t("fields.questions"),widths:[58,72],headers:[t("fields.question"),t("fields.answer")],rows:roundQuestions.map((q,i)=>[q,answers[i] ?? ""])},
    {name:t("fields.draftsSheet"),widths,headers,rows:records(pilotDrafts(rows))}];
}

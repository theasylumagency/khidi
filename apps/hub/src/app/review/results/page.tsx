import { listPilot,nextCandidates,roundDetails,roundFinished,reviewRoles } from "@khidi/catalog-review";
import { getDb } from "@khidi/db";
import { notFound } from "next/navigation";
import { requirePageAuth } from "../../../lib/session.ts";
import { PilotResults } from "../../../components/catalog-feedback.tsx";
export const dynamic="force-dynamic";
export default async function PilotResultsPage({searchParams}:{searchParams:Promise<{round?:string;type?:string}>}) {
  const principal=await requirePageAuth({allowedRoles:[...reviewRoles]}), params=await searchParams, db=getDb();
  const latest=await listPilot(db,principal), current=latest[0]?.round ?? 0;
  const round=params.round===undefined?current:Number(params.round);
  if (!Number.isSafeInteger(round) || round<1 || round>current) notFound();
  const rows=round===current?latest:await listPilot(db,principal,round), details=await roundDetails(db,rows);
  const candidates=roundFinished(rows,details.closure) && !details.decision?await nextCandidates(db,principal,rows):[];
  return <PilotResults rows={rows} details={details} candidates={candidates} current={current} type={params.type} admin={principal.role==="ADMIN"}/>;
}

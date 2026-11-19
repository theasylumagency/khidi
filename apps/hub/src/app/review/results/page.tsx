import { listPilot, reviewRoles } from "@khidi/catalog-review";
import { getDb } from "@khidi/db";
import { requirePageAuth } from "../../../lib/session.ts";
import { PilotResults } from "../../../components/catalog-feedback.tsx";

export const dynamic = "force-dynamic";
export default async function PilotResultsPage() {
  const principal = await requirePageAuth({ allowedRoles: [...reviewRoles] });
  return <PilotResults rows={await listPilot(getDb(), principal)}/>;
}

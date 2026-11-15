import { redirect } from "next/navigation";
import { getDb } from "@khidi/db";
import { listLegalEntities, listStorefronts, listEntityRelationships } from "@khidi/entities";
import { listUsersWithMemberships } from "@khidi/auth";
import { formatStaffName, getNavigationForRole } from "@khidi/i18n";
import { WorkspaceOverview } from "../components/workspace-overview.tsx";
import { requirePageAuth } from "../lib/session.ts";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const principal = await requirePageAuth();
  if (principal.role === "WAREHOUSE") redirect("/warehouse/tasks");
  const db = getDb();

  const [entities, storefronts, relationships] = await Promise.all([
    listLegalEntities(db),
    listStorefronts(db),
    listEntityRelationships(db)
  ]);
  const admin = principal.role === "ADMIN";
  const users = admin ? await listUsersWithMemberships(db, principal) : [];
  const navigation = getNavigationForRole(principal.role, principal.permissions);

  const date = new Intl.DateTimeFormat("ka-GE", { timeZone: "Asia/Tbilisi", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  return <WorkspaceOverview navigation={navigation} name={formatStaffName(principal.fullName).split(/\s+/)[0] ?? ""}
    date={date} entities={entities.length} storefronts={storefronts.length} users={users.length}
    mode={relationships[0]?.mode} admin={admin} />;
}

import { getDb } from "@khidi/db";
import { listUsersWithMemberships,setupLinkHours } from "@khidi/auth";
import { listLegalEntities } from "@khidi/entities";
import { USER_ROLES,GRANULAR_PERMISSIONS } from "@khidi/shared";
import { t } from "@khidi/i18n";
import { requirePageAuth,isSharedWarehouseBrowser } from "../../lib/session.ts";
import { RegisterDeviceButton } from "../../components/register-device-button.tsx";
import { UserManagement } from "../../components/user-management.tsx";
export const dynamic="force-dynamic";
export default async function UsersPage() {
 const principal=await requirePageAuth({ allowedRoles: ["ADMIN"] }),db=getDb();
 const [users,entities,hours,sharedDevice]=await Promise.all([listUsersWithMemberships(db,principal),listLegalEntities(db),setupLinkHours(db),isSharedWarehouseBrowser()]);
 return <div style={{display:"grid",gap:"1.5rem"}}>
  <UserManagement users={users} entities={entities.map(e=>({id:e.id,key:e.key}))} roles={[...USER_ROLES]} permissions={[...GRANULAR_PERMISSIONS]} selfId={principal.userId} hours={hours} sharedDevice={sharedDevice}/>
  <section><h2>{t("auth.warehouse_pin")}</h2><RegisterDeviceButton sharedDevice={sharedDevice}/></section>
 </div>;
}

import { requirePageAuth } from "../../../lib/session.ts";
import { AccountSecurity } from "../../../components/account-security.tsx";
import { redirect } from "next/navigation";
export default async function AccountSecurityPage() {
  const principal = await requirePageAuth({ allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER", "ORDER_MANAGER"] });
  if (principal.authMethod === "WAREHOUSE_PIN") redirect("/");
  return <AccountSecurity email={principal.email!} />;
}

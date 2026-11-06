import { requirePageAuth } from "../../../lib/session.ts";
import { AccountSecurity } from "../../../components/account-security.tsx";
import { redirect } from "next/navigation";
export default async function AccountSecurityPage({ searchParams }: { searchParams: Promise<{ offer?: string }> }) {
  const principal = await requirePageAuth({ allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER", "ORDER_MANAGER"] });
  if (principal.authMethod === "WAREHOUSE_PIN") redirect("/");
  return <AccountSecurity email={principal.email!} sessionId={principal.sessionId!} offer={(await searchParams).offer === "1"} />;
}

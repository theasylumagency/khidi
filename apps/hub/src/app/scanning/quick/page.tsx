import Link from "next/link";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../../lib/session.ts";
import { AdminQuickScan } from "../../../components/admin-quick-scan.tsx";
import "../../../components/scanning.css";

export const dynamic = "force-dynamic";
export default async function QuickScanPage() {
  const principal = await requirePageAuth({ allowedRoles: ["ADMIN"] });
  return <section className="scanning-panel"><h1>{t("scanning.quick_scan")}</h1>
    <nav className="scanning-actions"><Link href="/tasks">{t("scanning.tasks")}</Link><Link href="/intakes">{t("scanning.intakes")}</Link><Link href="/labels">{t("scanning.labels")}</Link></nav>
    <AdminQuickScan userId={principal.userId} deviceId={principal.deviceId} />
  </section>;
}

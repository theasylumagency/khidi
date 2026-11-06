import Link from "next/link";
import { getDb } from "@khidi/db";
import { listMissingEvidence } from "@khidi/evidence";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../lib/session.ts";

export const dynamic = "force-dynamic";
export default async function NotificationsPage() {
  const principal = await requirePageAuth();
  const actions = principal.role === "ADMIN"
    ? (await listMissingEvidence(getDb(), { userId: principal.userId })).filter((sku) => sku.reverificationRequired) : [];
  return <section className="office-login">
    <h1>{t("evidence.notifications")}</h1>
    {actions.length ? <ul>{actions.map((sku) => <li key={sku.id}>
      <Link href={`/products/${sku.id}`}>{sku.name ?? sku.internalSku}</Link> · {t("evidence.reverification")}
    </li>)}</ul> : <p>{t("evidence.no_actions")}</p>}
    {principal.role === "ADMIN" ? <Link href="/evidence/missing">{t("evidence.missing")}</Link> : null}
  </section>;
}

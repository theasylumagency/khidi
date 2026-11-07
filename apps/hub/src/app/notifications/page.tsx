import Link from "next/link";
import { getDb } from "@khidi/db";
import { listMissingEvidence } from "@khidi/evidence";
import { t } from "@khidi/i18n";
import { listSkusRequiringContentReview } from "@khidi/products";
import { requirePageAuth } from "../../lib/session.ts";

export const dynamic = "force-dynamic";
export default async function NotificationsPage() {
  const principal = await requirePageAuth();
  const [identity, content] = principal.role === "ADMIN" ? await Promise.all([
    listMissingEvidence(getDb(), { userId: principal.userId }), listSkusRequiringContentReview(getDb())
  ]) : [[], []];
  const actions = [
    ...identity.filter((sku) => sku.reverificationRequired).map((sku) => ({ ...sku, reason: "evidence.reverification" as const })),
    ...content.map((sku) => ({ ...sku, reason: "content.review_required" as const }))
  ];
  return <section className="office-login">
    <h1>{t("evidence.notifications")}</h1>
    {actions.length ? <ul>{actions.map((sku) => <li key={`${sku.id}:${sku.reason}`}>
      <Link href={`/products/${sku.id}`}>{sku.name ?? sku.internalSku}</Link> · {t(sku.reason)}
    </li>)}</ul> : <p>{t("evidence.no_actions")}</p>}
    {principal.role === "ADMIN" ? <Link href="/evidence/missing">{t("evidence.missing")}</Link> : null}
  </section>;
}

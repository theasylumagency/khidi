import Link from "next/link";
import { getDb } from "@khidi/db";
import { listMissingEvidence } from "@khidi/evidence";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../../lib/session.ts";

export const dynamic = "force-dynamic";
export default async function MissingEvidencePage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const principal = await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const supplier = (await searchParams).supplier?.trim().slice(0, 200) ?? "";
  const rows = await listMissingEvidence(getDb(), { userId: principal.userId }, supplier);
  return <section className="office-login">
    <h1>{t("evidence.missing")}</h1>
    <form><label>{t("evidence.supplier")}<input name="supplier" defaultValue={supplier} maxLength={200} /></label>
      <button>{t("evidence.filter")}</button></form>
    <a href={`/api/evidence/export?supplier=${encodeURIComponent(supplier)}`}>{t("evidence.export")}</a>
    <table><thead><tr><th>SKU</th><th>{t("evidence.supplier")}</th><th>{t("evidence.fields")}</th><th>{t("evidence.status")}</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}>
        <td><Link href={`/products/${row.id}`}>{row.name ?? row.internalSku}</Link></td>
        <td>{row.supplierNames.join(", ")}</td><td>{row.missingFields.join(", ")}</td>
        <td>{row.reverificationRequired ? t("evidence.reverification") : row.missingAnchor ? t("evidence.no_anchor") : "—"}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}

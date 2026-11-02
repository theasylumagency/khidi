import Link from "next/link";
import { getDb } from "@khidi/db";
import { listLabelsToPrint } from "@khidi/scanning";
import { t } from "@khidi/i18n";
import { formatTbilisiDateTime } from "@khidi/shared";
import { requirePageAuth } from "../../lib/session.ts";
import "../../components/scanning.css";

export const dynamic = "force-dynamic";
export default async function LabelsPage() {
  const principal = await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const rows = await listLabelsToPrint(getDb(), principal);
  return <section className="scanning-panel">
    <h1>{t("scanning.labels")}</h1>
    <Link href="/tasks">{t("scanning.back")}</Link>
    <form action="/labels/print" method="get">
      <div className="scanning-table-wrap"><table><thead><tr>
        <th>{t("scanning.select")}</th><th>{t("scanning.sku")}</th><th>{t("scanning.product")}</th><th>{t("scanning.date")}</th>
      </tr></thead><tbody>{rows.map(({ intake, sku }) => <tr key={intake.id}>
        <td><input type="checkbox" name="intakeIds" value={intake.id} aria-label={`${t("scanning.select")} ${sku.internalSku}`} /></td>
        <td><Link href={`/products/${sku.id}`}>{sku.internalSku}</Link></td>
        <td>{sku.displayNameKa ?? sku.internalSku}</td><td>{formatTbilisiDateTime(intake.createdAt)}</td>
      </tr>)}</tbody></table></div>
      {rows.length ? <button type="submit">{t("scanning.print_selected")}</button> : <p>{t("scanning.empty")}</p>}
    </form>
  </section>;
}

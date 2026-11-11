import Link from "next/link";
import { getDb } from "@khidi/db";
import { intakeFiltersSchema, LABEL_STATUSES, listIntakes, listSplitLabelProgress, RESULT_STATES } from "@khidi/scanning";
import { formatStaffName, t, type TranslationKey } from "@khidi/i18n";
import { formatTbilisiDateTime } from "@khidi/shared";
import { requirePageAuth } from "../../lib/session.ts";
import "../../components/scanning.css";

export const dynamic = "force-dynamic";
export default async function IntakesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const raw = await searchParams;
  const parsed = intakeFiltersSchema.safeParse(Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== "" && value !== undefined)));
  if (!parsed.success) return <section className="scanning-panel"><p role="alert">{t("scanning.error.VALIDATION_ERROR")}</p><Link href="/intakes">{t("scanning.back")}</Link></section>;
  const filters = parsed.data;
  const result = await listIntakes(getDb(), principal, filters);
  const splitProgress=await listSplitLabelProgress(getDb(),principal);
  function pageHref(page: number) { const params = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, String(value)])), page: String(page) }); return `/intakes?${params}`; }
  return <section className="scanning-panel"><h1>{t("scanning.intakes")}</h1>
    <nav className="scanning-actions"><Link href="/tasks">{t("scanning.tasks")}</Link><Link href="/scanning/quick">{t("scanning.quick_scan")}</Link><Link href="/labels">{t("scanning.labels")}</Link></nav>
    {splitProgress.length?<details><summary>{t("correction.labels")}</summary>
      <p>{t("correction.labels_hint")}</p><table><thead><tr><th>{t("scanning.sku")}</th>
        <th>{t("correction.printed")}</th><th>{t("correction.resolved")}</th></tr></thead>
        <tbody>{splitProgress.map((row)=><tr key={row.sourceSkuId}><th scope="row">
          <Link href={`/products/${row.sourceSkuId}`}>{row.internalSku}</Link></th><td>{row.printed}</td><td>{row.resolved}</td></tr>)}</tbody>
      </table></details>:null}
    <form method="get"><div className="scanning-fields">
      {filters.taskId ? <input type="hidden" name="taskId" value={filters.taskId} /> : null}
      <label>{t("scanning.needs_review")}<select name="needsReview" defaultValue={filters.needsReview ?? ""}><option value="">{t("scanning.all")}</option><option value="yes">{t("scanning.needs_review")}</option><option value="no">{t("scanning.no_review_needed")}</option></select></label>
      <label>{t("media.photos_status")}<select name="photosMissing" defaultValue={filters.photosMissing ?? ""}><option value="">{t("scanning.all")}</option><option value="yes">{t("media.required_photos_missing")}</option><option value="no">{t("media.no_required_missing")}</option></select></label>
      <label>{t("scanning.result")}<select name="resultState" defaultValue={filters.resultState ?? ""}><option value="">{t("scanning.all")}</option>{RESULT_STATES.map((state) => <option key={state} value={state}>{t(`scanning.result.${state}`)}</option>)}</select></label>
      <label>{t("scanning.label_status")}<select name="labelStatus" defaultValue={filters.labelStatus ?? ""}><option value="">{t("scanning.all")}</option>{LABEL_STATUSES.map((status) => <option key={status} value={status}>{t(`scanning.label.${status}`)}</option>)}</select></label>
    </div><button type="submit">{t("scanning.filter")}</button></form>
    <div className="scanning-table-wrap"><table><thead><tr><th>{t("scanning.date")}</th><th>{t("scanning.sku")}</th><th>{t("scanning.result")}</th><th>{t("scanning.label_status")}</th><th>{t("scanning.scanner")}</th><th>{t("scanning.photos_pending")}</th></tr></thead>
      <tbody>{result.rows.map(({ intake, internalSku, scannedByName, photosMissing, photoAttentionReason }) => <tr key={intake.id}>
        <td><Link href={`/intakes/${intake.id}/review`}>{formatTbilisiDateTime(intake.scannedAt)}</Link></td><td>{intake.matchedSkuId ? <Link href={`/products/${intake.matchedSkuId}`}>{internalSku}</Link> : "—"}</td>
        <td>{t(`scanning.result.${intake.resultState}` as TranslationKey)}{intake.duplicateOfIntakeId ? ` · ${t("scanning.duplicate")}` : ""}{intake.reviewReason && !intake.reviewedAt ? ` · ${t("scanning.needs_review")}` : ""}</td>
        <td>{t(`scanning.label.${intake.labelStatus}` as TranslationKey)}</td><td>{formatStaffName(scannedByName)}</td><td>{t(photosMissing ? "media.required_photos_missing" : "media.no_required_missing")}{photoAttentionReason ? <p>{photoAttentionReason === "PLATE_ABSENT"?t("plate.documents"):photoAttentionReason==="CAPTURE_PENDING"?t("plate.pending"):photoAttentionReason === "SERVER_TIER1_DISAGREEMENT" ? t("media.quality_disagreement") : photoAttentionReason}</p> : null}</td>
      </tr>)}</tbody></table></div>
    {!result.rows.length ? <p>{t("scanning.empty")}</p> : null}
    <nav className="scanning-actions">{filters.page > 1 ? <Link href={pageHref(filters.page - 1)}>{t("scanning.previous")}</Link> : null}{result.hasMore ? <Link href={pageHref(filters.page + 1)}>{t("scanning.next")}</Link> : null}</nav>
  </section>;
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@khidi/db";
import { getIntakeReview } from "@khidi/scanning";
import { formatStaffName, t, type TranslationKey } from "@khidi/i18n";
import { AppError, createUuidV7, formatTbilisiDateTime } from "@khidi/shared";
import { requirePageAuth } from "../../../../lib/session.ts";
import { IntakeReviewForm } from "../../../../components/intake-review-form.tsx";
import { listMediaImageViews } from "@khidi/media";
import { AdminMediaPanel } from "../../../../components/admin-media-panel.tsx";

export const dynamic = "force-dynamic";
export default async function IntakeReviewPage({ params }: { params: Promise<{ intakeId: string }> }) {
  const principal = await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const { intakeId } = await params;
  let details: Awaited<ReturnType<typeof getIntakeReview>>;
  try { details = await getIntakeReview(getDb(), principal, intakeId); }
  catch (error) { if (error instanceof AppError && ["NOT_FOUND", "VALIDATION_ERROR"].includes(error.code)) notFound(); throw error; }
  const { intake, scanner, taskTitle, taskStatus, matches, referenceSku } = details;
  const reason = intake.reviewReason ?? intake.reviewOriginalReason;
  const candidates = [...new Map(matches.map((sku) => [sku.skuId, sku])).values()];
  const images = await listMediaImageViews(getDb(), principal, { intakeId });
  return <section className="scanning-panel"><h1>{t("scanning.review")}</h1>
    <nav className="scanning-actions"><Link href="/intakes?needsReview=yes">{t("scanning.needs_review")}</Link><Link href="/products">{t("scanning.product")}</Link><Link href="/labels">{t("scanning.labels")}</Link></nav>
    <dl className="review-metadata">
      <dt>{t("scanning.original_code")}</dt><dd>{intake.scannedIdentifiersJson.join(" · ") || t("scanning.no_barcode")}</dd>
      <dt>{t("scanning.date")}</dt><dd>{formatTbilisiDateTime(intake.scannedAt)}</dd>
      <dt>{t("scanning.scanner")}</dt><dd>{formatStaffName(scanner)}</dd>
      <dt>{t("scanning.device")}</dt><dd>{intake.clientDeviceId}</dd>
      <dt>{t("scanning.task")}</dt><dd>{intake.taskId ? <Link href={`/intakes?taskId=${intake.taskId}`}>{taskTitle}</Link> : t("scanning.quick_scan")}</dd>
      {reason ? <><dt>{t("scanning.needs_review")}</dt><dd>{t(`scanning.review.${reason}` as TranslationKey)}</dd></> : null}
      {referenceSku ? <><dt>{t("scanning.archived_reference")}</dt><dd><Link href={`/products/${referenceSku.id}`}>{referenceSku.internalSku}</Link></dd></> : null}
      <dt>{t("scanning.result")}</dt><dd>{t(`scanning.result.${intake.resultState}` as TranslationKey)}</dd>
    </dl>
    {intake.reviewReason && !intake.reviewedAt ? <IntakeReviewForm intakeId={intake.id} idempotencyKey={createUuidV7()}
      canAccept={["TASK_NOT_ACCEPTING", "TASK_NOT_ASSIGNED"].includes(intake.reviewReason)}
      closedTask={!!taskStatus && !["OPEN", "IN_PROGRESS"].includes(taskStatus)}
      replacementRequired={intake.isNoBarcode || ["UNKNOWN_INTERNAL_LABEL", "ARCHIVED_INTERNAL_LABEL","SPLIT_INTERNAL_LABEL"].includes(intake.reviewReason)}
      candidates={candidates.map(({ internalSku, displayNameKa }) => ({ internalSku, displayNameKa }))} /> : <>
      {intake.reviewedAt ? <p>{t("scanning.review_closed")} · {formatTbilisiDateTime(intake.reviewedAt)} · {intake.reviewNote}</p> : null}
    </>}
    <AdminMediaPanel images={images} assignees={[]} />
  </section>;
}

import Link from "next/link";
import { getDb } from "@khidi/db";
import { getPrintableLabels } from "@khidi/scanning";
import { t } from "@khidi/i18n";
import { createUuidV7, AppError } from "@khidi/shared";
import { requirePageAuth } from "../../../lib/session.ts";
import { BatchLabelPrinter } from "../../../components/batch-label-printer.tsx";
import "../../../components/scanning.css";

export const dynamic = "force-dynamic";
export default async function LabelPrintPage({ searchParams }: { searchParams: Promise<{ intakeIds?: string | string[] }> }) {
  const principal = await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const params = await searchParams;
  const intakeIds = typeof params.intakeIds === "string" ? [params.intakeIds] : params.intakeIds ?? [];
  let html: string;
  try { html = await getPrintableLabels(getDb(), principal, intakeIds); }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    return <section className="scanning-panel"><p role="alert">{t(`scanning.error.${error.code}`)}</p><Link href="/labels">{t("scanning.back")}</Link></section>;
  }
  return <section className="scanning-panel"><h1>{t("scanning.labels")}</h1>
    <Link href="/labels">{t("scanning.back")}</Link><p>{t("scanning.print_help")}</p>
    <BatchLabelPrinter html={html} intakeIds={intakeIds} idempotencyKey={createUuidV7()} />
  </section>;
}

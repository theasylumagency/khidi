import Link from "next/link";
import { getDb } from "@khidi/db";
import { listMediaJobs } from "@khidi/media";
import { t, type TranslationKey } from "@khidi/i18n";
import { formatTbilisiDateTime } from "@khidi/shared";
import { requirePageAuth } from "../../../lib/session.ts";
import { MediaJobRetry } from "../../../components/media-job-retry.tsx";
export const dynamic = "force-dynamic";
export default async function MediaJobsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const principal = await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const page = Math.trunc(Math.max(1, Math.min(100000, Number((await searchParams).page) || 1))), jobs = await listMediaJobs(getDb(), principal, page);
  return <section className="scanning-panel"><h1>{t("media.jobs")}</h1><div className="scanning-table-wrap"><table><thead><tr><th>{t("media.job_type")}</th><th>{t("scanning.status")}</th><th>{t("media.attempts")}</th><th>{t("media.updated_at")}</th><th>{t("media.failure")}</th><th>{t("media.actions")}</th></tr></thead>
    <tbody>{jobs.rows.map((job) => <tr key={job.id}><td>{t(`media.job.${job.jobType}` as TranslationKey)}</td><td>{t(`media.job_status.${job.status}` as TranslationKey)}</td><td>{job.attempts} / {job.maxAttempts}</td><td>{formatTbilisiDateTime(job.updatedAt)}</td><td>{job.lastError ?? "—"}</td><td>{job.status === "DEAD_LETTER" ? <MediaJobRetry jobId={job.id} /> : null}</td></tr>)}</tbody></table></div>
    <nav>{page > 1 ? <Link href={`/media/jobs?page=${page - 1}`}>{t("scanning.previous")}</Link> : null}{jobs.hasMore ? <Link href={`/media/jobs?page=${page + 1}`}>{t("scanning.next")}</Link> : null}</nav></section>;
}

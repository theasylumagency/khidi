import Link from "next/link";
import { getDb } from "@khidi/db";
import { listAiJobs } from "@khidi/ai";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../../lib/session.ts";
import { AiJobAction } from "../../../components/ai-job-action.tsx";

export const dynamic = "force-dynamic";
export default async function EvidenceJobsPage() {
  await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const jobs = await listAiJobs(getDb());
  return <section className="office-login">
    <h1>{t("evidence.ai_jobs")}</h1>
    <table><thead><tr><th>{t("evidence.ai_job")}</th><th>{t("evidence.status")}</th><th>{t("evidence.ai_usage")}</th><th>{t("evidence.review")}</th></tr></thead>
      <tbody>{jobs.map((job) => <tr key={job.id}>
        <td><Link href={`/products/${job.skuId}`}>{job.jobName}</Link></td><td>{job.status}</td>
        <td><ul>{job.attempts.map((attempt) => <li key={attempt.id}>
          {attempt.provider} / {attempt.model} / {attempt.promptVersion} · {attempt.budgetDay} · {attempt.costUsdMicros === null
            ? `${t("evidence.ai_reserved")} ${attempt.reservedUsdMicros / 1_000_000} USD` : `${attempt.costUsdMicros / 1_000_000} USD`}
          {attempt.inputTokens !== null && attempt.outputTokens !== null
            ? <span> · {t("evidence.ai_tokens")} {attempt.inputTokens} / {attempt.outputTokens}</span> : null}
        </li>)}</ul></td>
        <td>{job.result ? <details><summary>{t("evidence.ai_result")}</summary><pre>{JSON.stringify(job.result, null, 2)}</pre></details> : null}
          {["DEAD_LETTER", "BUDGET_BLOCKED", "SKIPPED"].includes(job.status) ? <AiJobAction id={job.id} /> : null}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}

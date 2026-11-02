import Link from "next/link";
import { getDb } from "@khidi/db";
import { listAssignedScanTasks } from "@khidi/scanning";
import { t } from "@khidi/i18n";
import { formatTbilisiDateTime } from "@khidi/shared";
import { requirePageAuth } from "../../../lib/session.ts";

export const dynamic = "force-dynamic";
export default async function WarehouseTasksPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const principal = await requirePageAuth();
  const page = Math.trunc(Math.max(1, Math.min(100000, Number((await searchParams).page) || 1)));
  const tasks = await listAssignedScanTasks(getDb(), principal, page);
  return <section className="scanning-panel warehouse-tasks"><h1>{t(principal.role === "ADMIN" ? "scanning.tasks" : "scanner.my_tasks")}</h1>
    {!tasks.rows.length ? <p>{t("scanner.empty_tasks")}</p> : null}
    <ul>{tasks.rows.map((task) => <li key={task.id}><Link href={`/warehouse/tasks/${task.id}`}>
      <strong>{task.title}</strong><span>{t("scanning.progress")}: {task.completedCount} / {task.targetCount ?? "—"}</span>
      {task.dueDate ? <span>{t("scanning.due")}: {formatTbilisiDateTime(task.dueDate)}</span> : null}
      <span>{t("scanner.open")} →</span>
    </Link></li>)}</ul>
    <nav className="scanning-actions">{page > 1 ? <Link href={`/warehouse/tasks?page=${page - 1}`}>{t("scanning.previous")}</Link> : null}
      {tasks.hasMore ? <Link href={`/warehouse/tasks?page=${page + 1}`}>{t("scanning.next")}</Link> : null}</nav>
  </section>;
}

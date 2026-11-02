import Link from "next/link";
import { getDb } from "@khidi/db";
import { listScanTasks, listTaskAssignees } from "@khidi/scanning";
import { listProductTypes } from "@khidi/products";
import { t, type TranslationKey } from "@khidi/i18n";
import { createUuidV7, formatTbilisiDateTime } from "@khidi/shared";
import { requirePageAuth } from "../../lib/session.ts";
import { ScanTaskForm } from "../../components/scan-task-form.tsx";
import "../../components/scanning.css";

export const dynamic = "force-dynamic";
export default async function TasksPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const principal = await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const page = Math.max(1, Math.min(100000, Number((await searchParams).page) || 1));
  const db = getDb();
  const [tasks, assignees, productTypes] = await Promise.all([listScanTasks(db, principal, page), listTaskAssignees(db, principal), listProductTypes(db)]);
  const names = new Map(assignees.map((user) => [user.id, user.fullName]));
  return <section className="scanning-panel"><h1>{t("scanning.tasks")}</h1>
    <nav className="scanning-actions"><Link href="/scanning/quick">{t("scanning.quick_scan")}</Link><Link href="/intakes">{t("scanning.intakes")}</Link><Link href="/labels">{t("scanning.labels")}</Link></nav>
    <ScanTaskForm idempotencyKey={createUuidV7()} assignees={assignees.map(({ id, fullName }) => ({ id, fullName }))} productTypes={productTypes.filter((type) => type.active).map(({ id, nameKa }) => ({ id, nameKa }))} />
    <div className="scanning-table-wrap"><table><thead><tr><th>{t("scanning.title")}</th><th>{t("scanning.assignee")}</th><th>{t("scanning.progress")}</th><th>{t("scanning.status")}</th><th>{t("scanning.due")}</th></tr></thead>
      <tbody>{tasks.rows.map((task) => <tr key={task.id}>
        <td><Link href={`/intakes?taskId=${task.id}`}>{task.title}</Link></td>
        <td>{task.assigneeUserId ? names.get(task.assigneeUserId) ?? t("scanning.unset") : t(`scanning.role.${task.assigneeRole}` as TranslationKey)}</td>
        <td>{task.completedCount} / {task.targetCount ?? "—"}</td><td>{t(`scanning.task.${task.status}` as TranslationKey)}</td>
        <td>{task.dueDate ? formatTbilisiDateTime(task.dueDate) : "—"}</td>
      </tr>)}</tbody></table></div>
    {!tasks.rows.length ? <p>{t("scanning.empty")}</p> : null}
    <nav className="scanning-actions">{page > 1 ? <Link href={`/tasks?page=${page - 1}`}>{t("scanning.previous")}</Link> : null}
      {tasks.hasMore ? <Link href={`/tasks?page=${page + 1}`}>{t("scanning.next")}</Link> : null}</nav>
  </section>;
}

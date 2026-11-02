"use client";
import { useState, type FormEvent } from "react";
import { t } from "@khidi/i18n";
import type { UserRole } from "@khidi/shared";

export function ScanTaskForm({ assignees, productTypes, idempotencyKey }: {
  assignees: { id: string; fullName: string }[]; productTypes: { id: string; nameKa: string }[]; idempotencyKey: string
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const assignment = String(data.get("assignee"));
    const due = String(data.get("dueDate") ?? "");
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/scanning/tasks", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey,
          taskType: "INTAKE_UNIQUE", title: data.get("title"),
          assigneeUserId: assignment.startsWith("user:") ? assignment.slice(5) : null,
          assigneeRole: assignment.startsWith("role:") ? assignment.slice(5) : null,
          productTypeId: data.get("productTypeId") || null,
          targetCount: data.get("targetCount") ? Number(data.get("targetCount")) : null,
          dueDate: due ? new Date(`${due}:00+04:00`).toISOString() : null
        }) });
      if (!response.ok) { const body = await response.json(); setError(body.error ?? t("scanning.error")); return; }
      window.location.assign("/tasks");
    } catch { setError(t("scanning.error")); }
    finally { setBusy(false); }
  }
  const roles: UserRole[] = ["WAREHOUSE", "ADMIN", "OPERATOR", "STOCK_MANAGER", "ORDER_MANAGER"];
  return <form onSubmit={submit}>
    <h2>{t("scanning.create_task")}</h2>
    <div className="scanning-fields">
      <label>{t("scanning.title")}<input name="title" required maxLength={200} /></label>
      <label>{t("scanning.assignee")}<select name="assignee" required>
        {roles.map((role) => <option key={role} value={`role:${role}`}>{t(`scanning.role.${role}`)}</option>)}
        {assignees.map((user) => <option key={user.id} value={`user:${user.id}`}>{user.fullName}</option>)}
      </select></label>
      <label>{t("scanning.product_type")}<select name="productTypeId"><option value="">{t("scanning.unset")}</option>
        {productTypes.map((type) => <option key={type.id} value={type.id}>{type.nameKa}</option>)}
      </select></label>
      <label>{t("scanning.target")}<input name="targetCount" type="number" min={1} max={2147483647} step={1} /></label>
      <label>{t("scanning.due")}<input name="dueDate" type="datetime-local" /></label>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    <button type="submit" disabled={busy}>{t(busy ? "scanning.saving" : "scanning.create_task")}</button>
  </form>;
}

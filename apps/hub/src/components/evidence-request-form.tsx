"use client";

import { useRef, useState, type FormEvent } from "react";
import { t } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";

export function EvidenceRequestForm({ skuId, assignees }: { skuId: string; assignees: { id: string; fullName: string }[] }) {
  const key = useRef(createUuidV7()), [busy, setBusy] = useState(false), [status, setStatus] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget, data = new FormData(form);
    setBusy(true); setStatus("");
    try {
      const response = await fetch("/api/scanning/tasks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: key.current, taskType: "EVIDENCE_REQUEST", title: data.get("title"),
          targetSkuId: skuId, assigneeUserId: data.get("assignee"), photoRequestNote: data.get("note"), targetCount: 1 }) });
      if (!response.ok) throw new Error();
      key.current = createUuidV7(); form.reset(); setStatus(t("evidence.saved"));
    } catch { setStatus(t("evidence.error")); }
    finally { setBusy(false); }
  }
  return <details><summary>{t("evidence.request")}</summary><form onSubmit={(event) => void submit(event)}>
    <label>{t("evidence.task_title")}<input name="title" required maxLength={200} /></label>
    <label>{t("evidence.assignee")}<select name="assignee" required>
      <option value="">—</option>{assignees.map((user) => <option value={user.id} key={user.id}>{user.fullName}</option>)}
    </select></label>
    <label>{t("evidence.notes")}<input name="note" required maxLength={4000} /></label>
    <button disabled={busy || !assignees.length}>{t("evidence.request")}</button><p role="status">{status}</p>
  </form></details>;
}

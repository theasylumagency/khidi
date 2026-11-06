"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";

const catalogJobs = ["identify-product", "normalize-specifications", "classify-product", "generate-canonical-content"];

export function AiJobAction({ id, skuId }: { id?: string; skuId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [status, setStatus] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const jobName = new FormData(event.currentTarget).get("job");
    setBusy(true); setStatus("");
    try {
      const response = await fetch("/api/evidence/jobs", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": createUuidV7() },
        body: JSON.stringify(id ? { id } : { skuId, jobName }) });
      if (!response.ok) throw new Error();
      setStatus(t("evidence.saved")); router.refresh();
    } catch { setStatus(t("evidence.error")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={(event) => void submit(event)}>
    {!id ? <label>{t("evidence.ai_job")} <select name="job">{catalogJobs.map((job) => <option key={job}>{job}</option>)}</select></label> : null}
    <button disabled={busy}>{t(id ? "evidence.ai_retry" : "evidence.ai_queue")}</button>
    <p role="status">{status}</p>
  </form>;
}

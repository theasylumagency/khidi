"use client";
import Link from "next/link";
import { useState } from "react";
import { t } from "@khidi/i18n";
import { PhotoWorkspace, type CaptureContext } from "./photo-workspace.tsx";
export function PhotoRequestWork({ taskId, title, note, context }: { taskId: string; title: string; note: string; context: CaptureContext }) {
  const [finished, setFinished] = useState(false);
  return <><Link className="scanner-back" href="/warehouse/tasks">{t("scanner.back")}</Link><h1>{title}</h1><p>{note}</p>
    {finished ? <><p role="status">{t("media.request_saved")}</p><Link className="scanner-back" href="/warehouse/tasks">{t("scanner.back")}</Link></> :
    <PhotoWorkspace target={{ photoRequestTaskId: taskId }} initialContext={context} onlyMissing onComplete={() => setFinished(true)} />}</>;
}

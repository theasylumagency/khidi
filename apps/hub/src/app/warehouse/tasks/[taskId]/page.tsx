import { notFound } from "next/navigation";
import { getDb } from "@khidi/db";
import { getAssignedScanTask } from "@khidi/scanning";
import { AppError } from "@khidi/shared";
import { requirePageAuth } from "../../../../lib/session.ts";
import { WarehouseScanner } from "../../../../components/warehouse-scanner.tsx";
import { getPhotoCaptureContext } from "@khidi/media";
import { PhotoRequestWork } from "../../../../components/photo-request-work.tsx";
import { EvidenceCapture } from "../../../../components/evidence-capture.tsx";
import { getSkuWithDetails } from "@khidi/products";
import { evidenceFieldOptions } from "@khidi/evidence";
import { t } from "@khidi/i18n";

export const dynamic = "force-dynamic";
export default async function WarehouseScanPage({ params }: { params: Promise<{ taskId: string }> }) {
  const principal = await requirePageAuth();
  const { taskId } = await params;
  try {
    const task = await getAssignedScanTask(getDb(), principal, taskId);
    if (task.taskType === "EVIDENCE_REQUEST" && task.targetSkuId) {
      const { productType } = await getSkuWithDetails(getDb(), task.targetSkuId);
      return <section className="scanning-panel"><h1>{task.title}</h1><p>{task.photoRequestNote}</p>
        {["OPEN", "IN_PROGRESS"].includes(task.status)
          ? <EvidenceCapture skuId={task.targetSkuId} taskId={task.id} fields={evidenceFieldOptions(productType)} />
          : <p>{t("evidence.task_complete")}</p>}</section>;
    }
    if (task.taskType === "PHOTO_REQUEST") {
      const context = await getPhotoCaptureContext(getDb(), principal, { photoRequestTaskId: task.id });
      return <section className="scanning-panel"><PhotoRequestWork taskId={task.id} title={task.title} note={task.photoRequestNote!} context={context} /></section>;
    }
    return <section className="scanning-panel"><WarehouseScanner task={{ id: task.id, title: task.title, status: task.status, completedCount: task.completedCount, targetCount: task.targetCount, photosRequired: task.photosRequired }} /></section>;
  } catch (error) {
    if (error instanceof AppError && ["NOT_FOUND", "VALIDATION_ERROR"].includes(error.code)) notFound();
    throw error;
  }
}

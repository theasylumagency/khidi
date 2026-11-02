"use client";
import { useEffect, useRef, useState } from "react";
import { GENERIC_CAPTURE_SLOTS, type CaptureSlot, type PhotoSlot, type PhotoTarget } from "@khidi/media/contracts";
import { DEFAULT_QUALITY_CONFIG, type QualityConfig } from "@khidi/media/quality";
import { sameTarget } from "@khidi/scanning/offline-photos";
import { t } from "@khidi/i18n";
import { useScanQueue } from "./scan-queue-provider.tsx";
import { GuidedPhotoCapture } from "./guided-photo-capture.tsx";
export interface CaptureContext { target: PhotoTarget; slots: CaptureSlot[]; acceptedSlots: PhotoSlot[]; missingSlots: PhotoSlot[]; isDuplicate: boolean; canCompletePhotos: boolean; qualityConfig: QualityConfig }
export function PhotoWorkspace({ target, initialContext, onlyMissing = false, onComplete, onDuplicate }: { target: Partial<PhotoTarget>; initialContext?: CaptureContext; onlyMissing?: boolean; onComplete: () => void; onDuplicate?: (context: CaptureContext) => void }) {
  const queue = useScanQueue(), [context, setContext] = useState<CaptureContext | null>(initialContext ?? null), [local, setLocal] = useState<PhotoSlot[]>([]);
  const taken = useRef(false), nativePending = useRef(false), duplicate = useRef<CaptureContext | null>(null);
  const onDuplicateRef = useRef(onDuplicate); onDuplicateRef.current = onDuplicate;
  const targetKey = JSON.stringify(target), delivery = queue.lastDelivery?.key;
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch(`/api/media/capture?${new URLSearchParams(Object.entries(JSON.parse(targetKey)).filter(([, value]) => value).map(([key, value]) => [key, String(value)]))}`, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
        if (!response.ok) return;
        const body: CaptureContext = await response.json();
        if (controller.signal.aborted) return;
        setContext(body);
        if (body.isDuplicate && !onlyMissing) { duplicate.current = body; if (!taken.current && !nativePending.current) onDuplicateRef.current?.(body); }
      } catch { /* offline: generic required slots remain usable immediately */ }
    }
    void refresh(); window.addEventListener("online", refresh); window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); };
  }, [targetKey, delivery, queue.photoVersion, onlyMissing]);
  useEffect(() => { void queue.checkStorage(); }, []);
  const fullTarget: PhotoTarget = { skuId: null, intakeId: null, intakeIdempotencyKey: null, photoRequestTaskId: null, ...target };
  const pending = queue.photos.filter((photo) => sameTarget(photo.input, fullTarget)).map((photo) => photo.input.slot);
  const accepted = [...new Set([...(context?.acceptedSlots ?? []), ...pending, ...local])];
  const fallbackSlots = target.skuId ? GENERIC_CAPTURE_SLOTS.map((slot) => ({ ...slot, required: false })) : GENERIC_CAPTURE_SLOTS;
  const slots = (context?.slots ?? fallbackSlots).filter((slot) => !onlyMissing || (context ? context.missingSlots.includes(slot.slot) || local.includes(slot.slot) : !pending.includes(slot.slot)));
  return <div>{duplicate.current ? <p role="status">{t("media.already_scanned")}</p> : null}
    {queue.usage?.blocked ? <p role="alert">{t("media.quota_blocked")}</p> : null}
    {onlyMissing && context && !context.missingSlots.length && !local.length ? <><p>{t("media.photos_complete")}</p><button onClick={onComplete}>{t("media.finish_capture")}</button></> :
    <GuidedPhotoCapture slots={slots} acceptedSlots={accepted} qualityConfig={context?.qualityConfig ?? DEFAULT_QUALITY_CONFIG} disabled={queue.usage?.blocked || !queue.ready || context?.canCompletePhotos === false}
      onPhotoTaken={() => { taken.current = true; }} onNativePending={(value) => { nativePending.current = value; if (!value && duplicate.current && !taken.current) onDuplicateRef.current?.(duplicate.current); }}
      onAccept={async (photo) => { await queue.enqueuePhoto(target, photo); setLocal((slots) => [...new Set([...slots, photo.slot])]); }}
      onCannotPhotograph={(reason, slots) => queue.enqueueAttention(target, reason, slots)} onComplete={onComplete} />}
  </div>;
}

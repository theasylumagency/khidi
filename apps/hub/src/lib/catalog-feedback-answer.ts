import type { FeedbackResponse } from "@khidi/catalog-review";
import { t } from "@khidi/i18n";

/** Keep an unanswered question distinct from the reviewer's explicit uncertainty. */
export function pilotAnswerText(answer:FeedbackResponse["answers"][number]|undefined) {
  const state=answer?.state;
  return [t(state==="KNOWN"?"pilot.known":state==="UNKNOWN"?"pilot.unknown":"pilot.unanswered"),answer?.text,answer?.source]
    .filter(Boolean).join(" · ");
}

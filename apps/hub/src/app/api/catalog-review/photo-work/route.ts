import { assertRoleAllowed } from "@khidi/auth";
import { acceptInput, acceptReviewDraft, editInput, photoForm, rejectInput, rejectReviewDraft, renderInput, renderReviewDraft,
  requestReviewEdit, reviewId, reviewRoles, uploadReviewImage } from "@khidi/catalog-review";
import { getDb } from "@khidi/db";
import { getMediaStorage } from "@khidi/media";
import { AppError } from "@khidi/shared";
import { readBoundedForm } from "@khidi/shared/input-limits";
import { readBoundedJson } from "../../../../lib/request-body.ts";
import { assertSameSecurityOrigin } from "../../../../lib/security-origin.ts";
import { getCurrentPrincipal } from "../../../../lib/session.ts";

export const maxDuration = 180;
const headers = { "Cache-Control": "private, no-store" };
const statuses: Record<string, number> = { UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, VALIDATION_ERROR: 400, PAYLOAD_TOO_LARGE: 413, PRECONDITION_FAILED: 412 };

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal({ allowCatalogReviewer: true });
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, [...reviewRoles]);
    assertSameSecurityOrigin(request);
    const key = reviewId.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) throw new AppError("VALIDATION_ERROR","Invalid request key.");
    let result;
    if (request.headers.get("content-type")?.split(";")[0] === "multipart/form-data") {
      const fields = await readBoundedForm(request);
      const file = fields.get("image");
      fields.delete("image");
      const form = photoForm.safeParse(Object.fromEntries(fields.entries()));
      if (!form.success || !(file instanceof File) || file.size > 15 * 1024 * 1024) {
        throw new AppError("VALIDATION_ERROR","Invalid photo form.");
      }
      result = await uploadReviewImage(getDb(), getMediaStorage(), principal, key.data, form.data, new Uint8Array(await file.arrayBuffer()));
    } else {
      const body = await readBoundedJson(request, 4096);
      const layout = renderInput.safeParse(body), accept = acceptInput.safeParse(body);
      const edit = editInput.safeParse(body), reject = rejectInput.safeParse(body);
      if (layout.success) result = await renderReviewDraft(getDb(), getMediaStorage(), principal, key.data, layout.data);
      else if (accept.success) result = await acceptReviewDraft(getDb(), principal, key.data, accept.data);
      else if (edit.success) result = await requestReviewEdit(getDb(), getMediaStorage(), principal, key.data, edit.data);
      else if (reject.success) result = await rejectReviewDraft(getDb(), principal, key.data, reject.data);
      else throw new AppError("VALIDATION_ERROR","Invalid photo operation.");
    }
    return Response.json(result.body, { status: result.status, headers });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    if (error instanceof AppError && error.details?.photoStatus === "failed") {
      return Response.json({ error: "PHOTO_RENDER_FAILED" }, { status: 422, headers });
    }
    return Response.json({ error: code }, { status: statuses[code] ?? 500, headers });
  }
}

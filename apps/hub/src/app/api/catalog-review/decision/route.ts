import { assertRoleAllowed } from "@khidi/auth";
import { decisionInput, recordReviewDecision, reviewId, reviewRoles } from "@khidi/catalog-review";
import { getDb } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { readBoundedJson } from "../../../../lib/request-body.ts";

const headers = { "Cache-Control": "private, no-store" };
const statuses: Record<string, number> = {
  UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, PAYLOAD_TOO_LARGE: 413, VALIDATION_ERROR: 400
};

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal({ allowCatalogReviewer: true });
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, [...reviewRoles]);
    const body = decisionInput.safeParse(await readBoundedJson(request, 128 * 1024));
    const key = reviewId.safeParse(request.headers.get("idempotency-key"));
    if (!key.success || !body.success) throw new AppError("VALIDATION_ERROR", "Invalid catalog decision.");
    const result = await recordReviewDecision(getDb(), principal, key.data, body.data);
    return Response.json(result.body, { status: result.status, headers });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    return Response.json({ error: code }, { status: statuses[code] ?? 500, headers });
  }
}

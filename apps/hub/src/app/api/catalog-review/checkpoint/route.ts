import { assertRoleAllowed } from "@khidi/auth";
import { markReviewCheckpointViewed, reviewId } from "@khidi/catalog-review";
import { getDb } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { readBoundedJson } from "../../../../lib/request-body.ts";

const headers = { "Cache-Control": "private, no-store" };
const statuses: Record<string, number> = {
  UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409, PAYLOAD_TOO_LARGE: 413, VALIDATION_ERROR: 400
};

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal({ allowCatalogReviewer: true });
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["CATALOG_REVIEWER"]);
    const body = await readBoundedJson(request, 2048) as { id?: unknown } | null;
    const id = reviewId.safeParse(body?.id);
    if (!id.success) throw new AppError("VALIDATION_ERROR", "Invalid report ID.");
    const result = await markReviewCheckpointViewed(getDb(), principal, id.data);
    return Response.json(result.body, { status: result.status, headers });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    return Response.json({ error: code }, { status: statuses[code] ?? 500, headers });
  }
}

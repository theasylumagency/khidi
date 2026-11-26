import { assertRoleAllowed } from "@khidi/auth";
import { roundAction, reviewId, reviewRoles, saveRound } from "@khidi/catalog-review";
import { getDb } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { readBoundedJson } from "../../../../lib/request-body.ts";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const principal = await getCurrentPrincipal({ allowCatalogReviewer: true });
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, [...reviewRoles]);
    const input = roundAction.safeParse(await readBoundedJson(request, 512 * 1024));
    const key = reviewId.safeParse(request.headers.get("idempotency-key"));
    if (!key.success || !input.success) throw new AppError("VALIDATION_ERROR", "Invalid feedback.");
    const result = await saveRound(getDb(), principal, key.data, input.data);
    return Response.json(result.body, { status: result.status, headers });
  } catch (err) {
    const error = err instanceof AppError ? err.code : "INTERNAL_ERROR";
    const status: Record<string, number> = { UNAUTHORIZED:401, FORBIDDEN:403, NOT_FOUND:404, VALIDATION_ERROR:400,
      PAYLOAD_TOO_LARGE:413, CONFLICT:409, IDEMPOTENCY_CONFLICT:409 };
    const pendingRender=err instanceof AppError && err.code==="CONFLICT" && err.details?.reason==="PHOTO_RENDER_PENDING";
    return Response.json({ error, ...(pendingRender?{reason:"PHOTO_RENDER_PENDING"}:{}) }, { status: status[error] ?? 500, headers });
  }
}

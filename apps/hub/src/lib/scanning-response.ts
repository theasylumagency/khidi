import { NextResponse } from "next/server";
import { AppError } from "@khidi/shared";
import { t } from "@khidi/i18n";

export function scanningErrorResponse(error: unknown) {
  if (error instanceof AppError) {
    const status = { UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_ERROR: 400,
      CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, PRECONDITION_FAILED: 412, INVARIANT_VIOLATION: 422 }[error.code];
    const message = typeof error.details?.milestone === "number"
      ? t("scanning.available_from").replace("{milestone}", String(error.details.milestone))
      : t(`scanning.error.${error.code}`);
    return NextResponse.json({ error: message, code: error.code, blockedReason: error.details?.blockedReason, milestone: error.details?.milestone }, { status });
  }
  return NextResponse.json({ error: t(error instanceof SyntaxError ? "scanning.error.VALIDATION_ERROR" : "scanning.error") }, { status: error instanceof SyntaxError ? 400 : 500 });
}

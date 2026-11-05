import { NextResponse } from "next/server";
import { AppError } from "@khidi/shared";
import { t, type TranslationKey } from "@khidi/i18n";
export function mediaErrorResponse(error: unknown) {
  if (error instanceof AppError) {
    const reason = typeof error.details?.mediaReason === "string" ? error.details.mediaReason : null;
    const status = reason === "FILE_TOO_LARGE" ? 413 : { UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
      VALIDATION_ERROR: 400, CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, PRECONDITION_FAILED: 412, INVARIANT_VIOLATION: 422, RECENT_AUTH_REQUIRED: 428 }[error.code];
    return NextResponse.json({ error: reason ? t(`media.error.${reason}` as TranslationKey) : t(`scanning.error.${error.code}`), code: error.code, mediaReason: reason }, { status });
  }
  return NextResponse.json({ error: t("media.error.GENERIC") }, { status: 500 });
}

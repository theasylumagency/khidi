export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "RECENT_AUTH_REQUIRED"
  | "INVARIANT_VIOLATION"
  | "IDEMPOTENCY_CONFLICT";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}


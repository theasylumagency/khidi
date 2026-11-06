import { t, type TranslationKey } from "@khidi/i18n";

const messages = {
  CANCELLED: "passkey.cancelled", UNSUPPORTED: "passkey.platform_unavailable", TIMEOUT: "passkey.timeout",
  NOT_COMPLETED: "passkey.not_completed", CONFIGURATION: "passkey.configuration", VERIFICATION: "passkey.verification",
  NETWORK: "auth.network_error", SERVER: "auth.login_unavailable", RECENT_AUTH_REQUIRED: "passkey.reauth_required",
  FAILED: "passkey.operation_failed"
} as const satisfies Record<string, TranslationKey>;
export type PasskeyIssue = keyof typeof messages;

export class SecurityActionError extends Error {
  constructor(public readonly code: PasskeyIssue) { super(t(messages[code])); }
}

export function classifyPasskeyError(error: unknown, explicitlyCancelled = false): PasskeyIssue {
  if (explicitlyCancelled) return "CANCELLED";
  if (error instanceof SecurityActionError) return error.code;
  const details = error as { name?: string; code?: string; cause?: { name?: string } } | null;
  const name = details?.cause?.name ?? details?.name;
  if (name === "TimeoutError") return "TIMEOUT";
  if (name === "NotSupportedError" || (typeof details?.code === "string" && details.code.startsWith("ERROR_AUTHENTICATOR_MISSING_"))
    || details?.code === "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS") return "UNSUPPORTED";
  if (name === "NotAllowedError" || name === "AbortError") return "NOT_COMPLETED";
  if (name === "SecurityError" || name === "NotReadableError" || name === "ConstraintError" || name === "InvalidStateError"
    || details?.code === "ERROR_AUTHENTICATOR_GENERAL_ERROR") return "CONFIGURATION";
  return "VERIFICATION";
}

export function passkeyErrorMessage(error: unknown) { return t(messages[classifyPasskeyError(error)]); }

export function passkeyPlatform(userAgent: string, touchPoints: number): "android" | "ios" | "other" {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && touchPoints > 1)) return "ios";
  return "other";
}

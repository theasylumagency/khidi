"use client";
import { t } from "@khidi/i18n";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

export class SecurityActionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export async function securityRequest(action: string, input: Record<string, unknown> = {}) {
  const response = await fetch("/api/auth/passkeys", { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(["rename", "revoke", "change-password"].includes(action) ? { "Idempotency-Key": crypto.randomUUID() } : {}) },
    body: JSON.stringify({ action, ...input }) });
  const body = await response.json();
  if (!response.ok) throw new SecurityActionError(body.error ?? "FAILED", body.message ?? t("passkey.operation_failed"));
  return body;
}
export async function platformPasskeyAvailable(): Promise<boolean> {
  try { return typeof PublicKeyCredential !== "undefined" && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
}
export async function runPasskey(ceremony: "register" | "sign-in" | "reauth", displayName?: string) {
  const start = await securityRequest(`${ceremony}-options`);
  const sdk = await import("@simplewebauthn/browser");
  let response;
  try {
    response = ceremony === "register"
      ? await sdk.startRegistration({ optionsJSON: start.options as PublicKeyCredentialCreationOptionsJSON })
      : await sdk.startAuthentication({ optionsJSON: start.options as PublicKeyCredentialRequestOptionsJSON });
  } catch { throw new SecurityActionError("CANCELLED", t("passkey.cancelled")); }
  return securityRequest(`${ceremony}-verify`, { challengeId: start.challengeId, response, displayName });
}

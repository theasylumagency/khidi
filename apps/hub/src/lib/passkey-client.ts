"use client";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { classifyPasskeyError, SecurityActionError } from "./passkey-errors.ts";

export async function securityRequest(action: string, input: Record<string, unknown> = {}, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch("/api/auth/passkeys", { method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", ...(["rename", "revoke", "change-password"].includes(action) ? { "Idempotency-Key": crypto.randomUUID() } : {}) },
      body: JSON.stringify({ action, ...input }) });
  } catch { throw new SecurityActionError(signal?.aborted ? "CANCELLED" : "NETWORK"); }
  if (response.status >= 500) throw new SecurityActionError("SERVER");
  if (response.status === 428) throw new SecurityActionError("RECENT_AUTH_REQUIRED");
  if (!response.ok) throw new SecurityActionError(action.endsWith("-verify") || action.startsWith("sign-in-") ? "VERIFICATION" : "FAILED");
  const body = await response.json().catch(() => null);
  if (!body?.ok) throw new SecurityActionError("SERVER");
  return body;
}
export async function platformPasskeyAvailable(): Promise<boolean> {
  try { return typeof PublicKeyCredential !== "undefined" && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
}
export async function runPasskey(ceremony: "register" | "sign-in" | "reauth", displayName?: string, options?: {
  signal?: AbortSignal; onPhase?: (phase: "prompt" | "verify") => void;
}) {
  if (typeof PublicKeyCredential === "undefined") throw new SecurityActionError("UNSUPPORTED");
  const signal = options?.signal;
  const sdk = await import("@simplewebauthn/browser").catch(() => { throw new SecurityActionError("NETWORK"); });
  if (signal?.aborted) throw new SecurityActionError("CANCELLED");
  const start = await securityRequest(`${ceremony}-options`, {}, signal);
  if (signal?.aborted) throw new SecurityActionError("CANCELLED");
  if (typeof start.challengeId !== "string" || !start.options?.challenge) throw new SecurityActionError("SERVER");
  const abort = () => sdk.WebAuthnAbortService.cancelCeremony();
  signal?.addEventListener("abort", abort, { once: true });
  let response;
  try {
    options?.onPhase?.("prompt");
    if (signal?.aborted) throw new SecurityActionError("CANCELLED");
    response = ceremony === "register"
      ? await sdk.startRegistration({ optionsJSON: start.options as PublicKeyCredentialCreationOptionsJSON })
      : await sdk.startAuthentication({ optionsJSON: start.options as PublicKeyCredentialRequestOptionsJSON });
  } catch (error) { throw new SecurityActionError(classifyPasskeyError(error, signal?.aborted)); }
  finally { signal?.removeEventListener("abort", abort); }
  if (signal?.aborted) throw new SecurityActionError("CANCELLED");
  // Once verification starts, the browser cannot promise to undo a credential write.
  options?.onPhase?.("verify");
  return securityRequest(`${ceremony}-verify`, { challengeId: start.challengeId, response, displayName });
}

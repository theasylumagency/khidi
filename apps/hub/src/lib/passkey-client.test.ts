import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { t } from "@khidi/i18n";
import { runPasskey, securityRequest } from "./passkey-client.ts";
import { classifyPasskeyError, passkeyErrorMessage, passkeyPlatform } from "./passkey-errors.ts";

const sdk = vi.hoisted(() => ({ startRegistration: vi.fn(), cancelCeremony: vi.fn() }));
vi.mock("@simplewebauthn/browser", () => ({ startRegistration: sdk.startRegistration, WebAuthnAbortService: { cancelCeremony: sdk.cancelCeremony } }));
const mockFetch = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", mockFetch); vi.stubGlobal("PublicKeyCredential", class {}); });
afterEach(() => vi.unstubAllGlobals());

it("treats ambiguous native denial and interruption as unresolved, without exposing raw data", () => {
  const raw = new DOMException("private diagnostic or credential", "NotAllowedError");
  expect(classifyPasskeyError(raw)).toBe("NOT_COMPLETED");
  expect(classifyPasskeyError({ cause: raw })).toBe("NOT_COMPLETED");
  expect(classifyPasskeyError(new DOMException("private", "AbortError"))).toBe("NOT_COMPLETED");
  expect(passkeyErrorMessage(raw)).toBe(t("passkey.not_completed"));
  expect(passkeyErrorMessage(raw)).not.toContain(raw.message);
});

it.each([["TimeoutError", "TIMEOUT"], ["NotSupportedError", "UNSUPPORTED"], ["SecurityError", "CONFIGURATION"], ["UnknownError", "VERIFICATION"]])("classifies %s using stable names", (name, expected) => {
  expect(classifyPasskeyError(new DOMException("private", name))).toBe(expected);
});

it("classifies transport, verification, server and recent-auth failures without server text", async () => {
  for (const [status, code] of [[428, "RECENT_AUTH_REQUIRED"], [503, "SERVER"], [401, "VERIFICATION"]] as const) {
    mockFetch.mockResolvedValueOnce(Response.json({ message: "private" }, { status }));
    await expect(securityRequest("register-verify")).rejects.toMatchObject({ code });
  }
  mockFetch.mockRejectedValueOnce(new Error("private connection details"));
  await expect(securityRequest("register-options")).rejects.toMatchObject({ code: "NETWORK", message: t("auth.network_error") });
});

it("does not verify cancelled registration and retries only with a fresh options request", async () => {
  const controller = new AbortController();
  mockFetch.mockResolvedValueOnce(Response.json({ ok: true, challengeId: "first", options: { challenge: "synthetic-one" } }));
  sdk.startRegistration.mockImplementationOnce(async () => { controller.abort(); return { id: "synthetic" }; });
  await expect(runPasskey("register", "My key", { signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED", message: t("passkey.cancelled") });
  expect(sdk.cancelCeremony).toHaveBeenCalledOnce();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  mockFetch.mockResolvedValueOnce(Response.json({ ok: true, challengeId: "second", options: { challenge: "synthetic-two" } }));
  mockFetch.mockResolvedValueOnce(Response.json({ ok: true }));
  sdk.startRegistration.mockResolvedValueOnce({ id: "synthetic" });
  await runPasskey("register", "My key");
  expect(mockFetch.mock.calls.map(([, options]) => JSON.parse(options.body).action)).toEqual(["register-options", "register-options", "register-verify"]);
  expect(JSON.parse(mockFetch.mock.calls[2]![1].body).challengeId).toBe("second");
});

it("does not call the server on unsupported WebAuthn and distinguishes Android and desktop-mode iPad help", async () => {
  vi.stubGlobal("PublicKeyCredential", undefined);
  await expect(runPasskey("register")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(mockFetch).not.toHaveBeenCalled();
  expect(passkeyPlatform("Mozilla Android 15", 5)).toBe("android");
  expect(passkeyPlatform("Macintosh Safari", 5)).toBe("ios");
  expect(passkeyPlatform("Macintosh Safari", 0)).toBe("other");
});

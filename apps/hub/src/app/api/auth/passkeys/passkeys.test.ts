import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppError } from "@khidi/shared";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), shared: vi.fn(), begin: vi.fn(), finish: vi.fn(), list: vi.fn(), manage: vi.fn(), reauth: vi.fn(), totp: vi.fn(), password: vi.fn() }));
vi.mock("@khidi/db", () => ({ getDb: () => ({}) }));
vi.mock("@khidi/auth", () => ({ beginPasskeyCeremony: mocks.begin, finishPasskeyCeremony: mocks.finish,
  ownSecurityState: mocks.list, manageOwnPasskey: mocks.manage, reauthenticateWithPasswordTotp: mocks.reauth,
  startOwnTotpEnrollment: mocks.totp, changeOwnPassword: mocks.password, securityRequestFingerprint: () => "keyed-fingerprint" }));
vi.mock("../../../../lib/session.ts", () => ({ getCurrentPrincipal: mocks.principal, isSharedWarehouseBrowser: mocks.shared, KHIDI_SESSION_COOKIE: "khidi_session" }));
vi.mock("@khidi/domain", () => ({ executeIdempotent: async (_db: unknown, _options: unknown, callback: (tx: object) => unknown) => callback({}) }));
import { GET, POST } from "./route.ts";
const principal = { userId: "fixture", role: "ADMIN", authMethod: "OFFICE_PASSWORD_TOTP", sessionId: "session" };
function request(action: string, input = {}, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3100/api/auth/passkeys", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3100", ...headers }, body: JSON.stringify({ action, ...input }) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.principal.mockResolvedValue(null); mocks.shared.mockResolvedValue(false); });
it("issues generic discoverable options and an HttpOnly ceremony binding, without an office session", async () => {
  mocks.begin.mockResolvedValueOnce({ challengeId: "fixture", bindingToken: "a".repeat(64), options: { challenge: "fixture-challenge", allowCredentials: [] } });
  const response = await POST(request("sign-in-options"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toContain("khidi_webauthn"); expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=strict"); expect(cookie).not.toContain("khidi_session");
});
it("checks authentication, recent proof and shared-device restrictions on registration", async () => {
  expect((await POST(request("register-options"))).status).toBe(401);
  mocks.principal.mockResolvedValue(principal);
  mocks.begin.mockRejectedValueOnce(new AppError("RECENT_AUTH_REQUIRED", "Recent proof required"));
  expect((await POST(request("register-options"))).status).toBe(428);
  mocks.shared.mockResolvedValue(true);
  expect((await POST(request("register-options"))).status).toBe(403);
  expect((await POST(request("sign-in-options"))).status).toBe(401);
});
it("rejects a warehouse PIN session even if the device cookie was cleared", async () => {
  mocks.principal.mockResolvedValue({ ...principal, authMethod: "WAREHOUSE_PIN" });
  expect((await POST(request("sign-in-options"))).status).toBe(401);
  expect((await POST(request("register-options"))).status).toBe(401);
  expect(mocks.begin).not.toHaveBeenCalled();
});
it("rejects cross-origin/non-JSON state changes before invoking auth services", async () => {
  expect((await POST(request("sign-in-options", {}, { Origin: "https://other.example" }))).status).toBe(403);
  expect((await POST(request("sign-in-options", {}, { "Content-Type": "text/plain" }))).status).toBe(403);
  expect(mocks.begin).not.toHaveBeenCalled();
});
it("returns the same safe sign-in failure and clears the binding on all verifier failures", async () => {
  let first: unknown;
  for (const message of ["Unknown credential", "Revoked key", "Inactive user", "Wrong signature", "Expired challenge"]) {
    mocks.finish.mockRejectedValueOnce(new AppError("UNAUTHORIZED", message));
    const response = await POST(request("sign-in-verify", { challengeId: "fixture", response: {} }));
    expect(response.status).toBe(401); expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    const body = await response.json(); if (!first) first = body;
    expect(body).toEqual(first); expect(JSON.stringify(body)).not.toContain(message);
  }
});
it("sets a normal HttpOnly session cookie only after successful assertion verification", async () => {
  mocks.finish.mockResolvedValueOnce({ sessionToken: "khidi_sess_synthetic", principal: {} });
  const response = await POST(request("sign-in-verify", { challengeId: "fixture", response: {} }, { Cookie: `khidi_webauthn=${"b".repeat(64)}` }));
  expect(response.headers.get("set-cookie")).toContain("khidi_session=khidi_sess_synthetic");
  expect(await response.json()).toEqual({ ok: true });
  expect(mocks.finish).toHaveBeenCalledWith({}, expect.objectContaining({ bindingToken: "b".repeat(64) }));
});
it("never lists credentials without an authenticated office principal", async () => {
  expect((await GET()).status).toBe(401);
  mocks.principal.mockResolvedValue({ ...principal, authMethod: "WAREHOUSE_PIN" });
  expect((await GET()).status).toBe(401);
  expect(mocks.list).not.toHaveBeenCalled();
});

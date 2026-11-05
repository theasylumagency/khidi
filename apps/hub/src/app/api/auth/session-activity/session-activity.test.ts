import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppError } from "@khidi/shared";
const mocked = vi.hoisted(() => ({ principal: vi.fn(), renew: vi.fn(), logout: vi.fn() }));
vi.mock("@khidi/db", () => ({ getDb: () => ({}) }));
vi.mock("@khidi/auth", () => ({ renewSessionActivity: mocked.renew, revokeSessionToken: mocked.logout }));
vi.mock("../../../../lib/session.ts", () => ({ getCurrentPrincipal: mocked.principal, KHIDI_SESSION_COOKIE: "khidi_session" }));
import { POST } from "./route.ts";
import { POST as logout } from "../logout/route.ts";

const sessionId = "01930000-0000-7000-8000-000000000001";
const timing = { sessionId, lastActivityAtMs: 1_000_000, deadlineMs: 2_200_000, serverNowMs: 1_000_000, absoluteDeadlineMs: 3_000_000, activityIntervalMs: 30_000 };
function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3100/api/auth/session-activity", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3100", Cookie: "khidi_session=synthetic", ...headers }, body: JSON.stringify({ sessionId, ...body }) });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("WEBAUTHN_ORIGIN", "http://localhost:3100"); vi.stubEnv("WEBAUTHN_RP_ID", "localhost");
  mocked.principal.mockResolvedValue({ sessionTiming: timing }); mocked.renew.mockResolvedValue(timing);
});
afterEach(() => vi.unstubAllEnvs());

it("uses read-only status for wake, polling or another tab's activity", async () => {
  const response = await POST(request({ action: "status" }));
  expect(await response.json()).toEqual(timing);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(mocked.renew).not.toHaveBeenCalled();
});

it("passes only the token-bound session and its previous revision to the renewal transaction", async () => {
  const response = await POST(request({ action: "activity", lastActivityAtMs: timing.lastActivityAtMs, deadlineMs: Number.MAX_SAFE_INTEGER }));
  expect(response.status).toBe(200);
  expect(mocked.renew).toHaveBeenCalledExactlyOnceWith({}, "synthetic", sessionId, timing.lastActivityAtMs);
  expect(await response.json()).toEqual(timing);
});

it("rejects cross-origin requests, missing cookie and invalid activity without touching state", async () => {
  expect((await POST(request({ action: "activity" }, { Origin: "https://elsewhere.example" }))).status).toBe(403);
  expect((await POST(request({ action: "activity" }, { "Sec-Fetch-Site": "cross-site" }))).status).toBe(403);
  expect((await POST(request({ action: "activity" }, { Cookie: "" }))).status).toBe(401);
  expect((await POST(request({ action: "activity" }))).status).toBe(400);
  expect(mocked.renew).not.toHaveBeenCalled();
});

it("distinguishes authoritative expiry from service outage, without clearing a new tab's cookie", async () => {
  mocked.principal.mockResolvedValueOnce({ sessionTiming: { ...timing, sessionId: "new-session" } });
  const stale = await POST(request({ action: "status" }));
  expect(stale.status).toBe(401); expect(stale.headers.get("set-cookie")).toBeNull();
  mocked.renew.mockRejectedValueOnce(new AppError("UNAUTHORIZED", "internal expired session details"));
  expect(await (await POST(request({ action: "activity", lastActivityAtMs: timing.lastActivityAtMs }))).json()).toEqual({ ok: false, error: "SESSION_ENDED" });
  mocked.principal.mockRejectedValueOnce(new Error("private service error"));
  const failed = await POST(request({ action: "status" }));
  expect(failed.status).toBe(503); expect(await failed.json()).toEqual({ ok: false });
});

it("does not clear or revoke a replacement cookie when an old tab asks to log out", async () => {
  mocked.logout.mockResolvedValueOnce(false);
  const response = await logout(request({}));
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(mocked.logout).toHaveBeenCalledExactlyOnceWith({}, "synthetic", sessionId);
  expect((await logout(request({}, { Origin: "https://elsewhere.example" }))).status).toBe(403);
  expect(mocked.logout).toHaveBeenCalledOnce();
});

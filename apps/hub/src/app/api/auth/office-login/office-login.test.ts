import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppError } from "@khidi/shared";
import { renderInternalQrSvg } from "@khidi/products/labels";
import { QUICK_SIGN_IN_COOKIE, readQuickSignInPreference } from "../../../../lib/quick-sign-in-cookie.ts";
const login = vi.hoisted(() => vi.fn());
const passkeys = vi.hoisted(() => vi.fn());
const shared = vi.hoisted(() => vi.fn());
vi.mock("@khidi/auth", () => ({ loginOfficeUser: login, listOwnPasskeys: passkeys }));
vi.mock("@khidi/db", () => ({ getDb: () => ({}) }));
vi.mock("../../../../lib/session.ts", () => ({ KHIDI_SESSION_COOKIE: "khidi_session", isSharedWarehouseBrowser: shared }));
import { POST } from "./route.ts";
beforeEach(() => { login.mockReset(); passkeys.mockReset().mockResolvedValue([]); shared.mockReset().mockResolvedValue(false); });
it("returns password-verified enrollment instructions without a session cookie or caching", async () => {
  const enrollment = { base32Secret: "LOCAL_TEST_SECRET", otpauthUri: "otpauth://totp/Khidi:test", accountLabel: "Khidi — test" };
  login.mockRejectedValueOnce(new AppError("PRECONDITION_FAILED", "Enrollment required", { totpEnrollment: enrollment }));
  const response = await POST(new NextRequest("https://khidi.example/api/auth/office-login", { method: "POST", body: JSON.stringify({ email: "first@khidi.example", password: "Synthetic-test-password" }) }));
  expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true, enrollment: { ...enrollment, qrSvg: renderInternalQrSvg(enrollment.otpauthUri, 240) } });
});

it("passes an explicit start-over through password verification, without accepting client enrollment data", async () => {
  login.mockRejectedValueOnce(new AppError("UNAUTHORIZED", "Invalid credentials."));
  const response = await POST(new NextRequest("https://khidi.example/api/auth/office-login", { method: "POST", body: JSON.stringify({ email: "test@khidi.example", password: "Synthetic-test-password", restartEnrollment: true }) }));
  expect(login).toHaveBeenLastCalledWith({}, expect.objectContaining({ restartEnrollment: true, password: "Synthetic-test-password" }));
  expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await response.json()).not.toHaveProperty("enrollment");
});

it("returns identical informative public errors for unknown/inactive users, wrong passwords/codes and lockout", async () => {
  let firstBody: unknown;
  for (const reason of ["Unknown account", "Inactive user", "Wrong password", "Invalid or missing TOTP code", "Account temporarily locked"]) {
    login.mockRejectedValueOnce(new AppError("UNAUTHORIZED", reason));
    const response = await POST(new NextRequest("https://khidi.example/api/auth/office-login", { method: "POST",
      body: JSON.stringify({ email: "fixture@khidi.example", password: "Synthetic-test-password", totpCode: "001234" }) }));
    expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.json();
    if (!firstBody) firstBody = body;
    expect(body).toEqual(firstBody);
    expect(body.message).toContain("ელ-ფოსტა"); expect(body.message).toContain("პაროლი"); expect(body.message).toContain("6-ციფრიანი კოდი");
    expect(body).not.toHaveProperty("enrollment"); expect(JSON.stringify(body)).not.toContain(reason);
  }
});

it("does not blame credentials or expose raw details when the service fails", async () => {
  login.mockRejectedValueOnce(new Error("Database error with private bound parameters"));
  const response = await POST(new NextRequest("https://khidi.example/api/auth/office-login", { method: "POST",
    body: JSON.stringify({ email: "fixture@khidi.example", password: "Synthetic-test-password" }) }));
  expect(response.status).toBe(500); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  const body = await response.json();
  expect(body.message).toContain("დროებით"); expect(JSON.stringify(body)).not.toContain("private bound parameters");
});

it("preserves password case/whitespace and leading zeroes in the submitted TOTP code", async () => {
  login.mockRejectedValueOnce(new AppError("UNAUTHORIZED", "Invalid credentials"));
  await POST(new NextRequest("https://khidi.example/api/auth/office-login", { method: "POST",
    body: JSON.stringify({ email: "fixture@khidi.example", password: "  Synthetic-aBc-123  ", totpCode: "001234" }) }));
  expect(login).toHaveBeenLastCalledWith({}, expect.objectContaining({ password: "  Synthetic-aBc-123  ", totpCode: "001234" }));
});

it.each(["strong", "weak", "shared", "existing"])("offers explicit passkey setup only after strong office proof on a personal browser (%s)", async (kind) => {
  login.mockResolvedValueOnce({ sessionToken: "khidi_sess_synthetic", principal: { userId: "fixture", lastStrongAuthAt: kind === "weak" ? null : new Date() } });
  shared.mockResolvedValueOnce(kind === "shared");
  passkeys.mockResolvedValueOnce(kind === "existing" ? [{ id: "fixture-key" }] : []);
  const response = await POST(new NextRequest("http://localhost:3100/api/auth/office-login", { method: "POST", body: JSON.stringify({ email: "fixture@khidi.example", password: "Synthetic-test-password", totpCode: "001234" }) }));
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("khidi_session=khidi_sess_synthetic");
  expect(await response.json()).toMatchObject({ offerPasskey: kind === "strong" });
});

it("offers setup once for the remembered account and offers it separately to another account", async () => {
  const firstUser = "019a11a1-1111-7111-8111-111111111111";
  const secondUser = "019a11a1-1111-7111-8111-111111111112";
  async function signIn(userId: string, preference = "") {
    login.mockResolvedValueOnce({ sessionToken: "khidi_sess_synthetic", principal: { userId, lastStrongAuthAt: new Date() } });
    return POST(new NextRequest("http://localhost:3100/api/auth/office-login", { method: "POST",
      headers: { Cookie: `${QUICK_SIGN_IN_COOKIE}=${preference}` },
      body: JSON.stringify({ email: "fixture@khidi.example", password: "Synthetic-test-password", totpCode: "001234" }) }));
  }
  const first = await signIn(firstUser);
  expect(await first.json()).toMatchObject({ offerPasskey: true });
  const value = first.cookies.get(QUICK_SIGN_IN_COOKIE)?.value;
  expect(readQuickSignInPreference(value)).toEqual({ id: firstUser, mode: "offered" });
  expect(await (await signIn(firstUser, value)).json()).toMatchObject({ offerPasskey: false });
  expect(await (await signIn(secondUser, value)).json()).toMatchObject({ offerPasskey: true });
});

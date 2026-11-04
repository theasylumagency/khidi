import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppError } from "@khidi/shared";
import { renderInternalQrSvg } from "@khidi/products/labels";
const login = vi.hoisted(() => vi.fn());
vi.mock("@khidi/auth", () => ({ loginOfficeUser: login }));
vi.mock("@khidi/db", () => ({ getDb: () => ({}) }));
vi.mock("../../../../lib/session.ts", () => ({ KHIDI_SESSION_COOKIE: "khidi_session" }));
import { POST } from "./route.ts";
beforeEach(() => login.mockReset());
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

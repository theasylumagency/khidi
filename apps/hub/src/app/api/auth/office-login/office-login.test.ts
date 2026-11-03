import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppError } from "@khidi/shared";
const login = vi.hoisted(() => vi.fn());
vi.mock("@khidi/auth", () => ({ loginOfficeUser: login }));
vi.mock("@khidi/db", () => ({ getDb: () => ({}) }));
vi.mock("../../../../lib/session.ts", () => ({ KHIDI_SESSION_COOKIE: "khidi_session" }));
import { POST } from "./route.ts";
it("returns password-verified enrollment instructions without a session cookie or caching", async () => {
  const enrollment = { base32Secret: "LOCAL_TEST_SECRET", otpauthUri: "otpauth://totp/Khidi:test" };
  login.mockRejectedValueOnce(new AppError("PRECONDITION_FAILED", "Enrollment required", { totpEnrollment: enrollment }));
  const response = await POST(new NextRequest("https://khidi.example/api/auth/office-login", { method: "POST", body: JSON.stringify({ email: "first@khidi.example", password: "Synthetic-test-password" }) }));
  expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true, enrollment });
});

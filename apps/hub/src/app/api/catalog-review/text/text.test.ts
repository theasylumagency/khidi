import { beforeEach, expect, it, vi } from "vitest";
import { createUuidV7 as uuid } from "@khidi/shared";

const mocks = vi.hoisted(() => ({ principal: vi.fn(), create: vi.fn() }));
vi.mock("../../../../lib/session.ts", () => ({ getCurrentPrincipal: mocks.principal }));
vi.mock("@khidi/catalog-review", async (importActual) => ({
  ...await importActual<typeof import("@khidi/catalog-review")>(), createReviewText: mocks.create
}));
import { POST } from "./route.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.principal.mockResolvedValue({ userId: uuid(), role: "CATALOG_REVIEWER", authMethod: "OFFICE_PASSWORD_TOTP" });
  mocks.create.mockResolvedValue({ status: 201, body: { id: uuid(), revision: 1 } });
});
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3100/api/catalog-review/text", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3100",
      Host: "localhost:3100", "Idempotency-Key": uuid(), ...headers }, body: JSON.stringify(body)
  });
}
const input = () => ({ productId: uuid(), field: "NAME", text: "  ქართული ტექსტი\n7 HP  " });

it("requires a session and reviewer/admin role before writing", async () => {
  mocks.principal.mockResolvedValueOnce(null);
  expect((await POST(request(input()))).status).toBe(401);
  mocks.principal.mockResolvedValueOnce({ userId: uuid(), role: "OPERATOR" });
  expect((await POST(request(input()))).status).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("rejects a cross-origin request before calling the domain operation", async () => {
  expect((await POST(request(input(), { Origin: "https://attacker.example" }))).status).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("requires a valid idempotency key and rejects fields outside the text-entry contract", async () => {
  expect((await POST(request(input(), { "Idempotency-Key": "invalid" }))).status).toBe(400);
  expect((await POST(request({ ...input(), field: "PHOTO" }))).status).toBe(400);
  expect((await POST(request({ ...input(), action: "APPROVE" }))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("bounds request bytes before parsing a large text payload", async () => {
  expect((await POST(request({ ...input(), text: "x".repeat(128 * 1024) }))).status).toBe(413);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("passes exact text and the supplied key to the domain operation and returns a private response", async () => {
  const value = input(), key = uuid();
  const response = await POST(request(value, { "Idempotency-Key": key }));
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.create.mock.calls[0]?.slice(2)).toEqual([key, value]);
});

import { beforeEach, expect, it, vi } from "vitest";
import { AppError, createUuidV7 } from "@khidi/shared";

const mock = vi.hoisted(() => ({ principal: vi.fn(), upload: vi.fn(), render: vi.fn(), accept: vi.fn() }));
vi.mock("../../../../lib/session.ts", () => ({ getCurrentPrincipal: mock.principal }));
vi.mock("@khidi/catalog-review", async (actual) => ({
  ...await actual<typeof import("@khidi/catalog-review")>(),
  uploadReviewImage: mock.upload, renderReviewDraft: mock.render, acceptReviewDraft: mock.accept
}));
import { POST } from "./route.ts";

const productId = createUuidV7();
const key = createUuidV7();
const origin = "http://localhost:3100";
function request(body: FormData | Record<string, unknown>) {
  const headers = { Host: "localhost:3100", Origin: origin, "Idempotency-Key": key };
  return new Request(origin + "/api/catalog-review/photo-work", body instanceof FormData
    ? { method: "POST", headers, body }
    : { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mock.principal.mockResolvedValue({ userId: createUuidV7(), role: "CATALOG_REVIEWER", authMethod: "OFFICE_PASSWORD_TOTP" });
});

it("passes a multipart upload to the assigned review workflow with its retry key", async () => {
  const bytes = new Uint8Array([11, 22, 33]);
  const form = new FormData();
  form.set("productId", productId);
  form.set("kind", "UPLOAD");
  form.set("image", new File([bytes], "review.png", { type: "image/png" }));
  mock.upload.mockResolvedValue({ status: 201, body: { id: productId } });
  const response = await POST(request(form));
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mock.upload.mock.calls[0]?.slice(3)).toEqual([key, { productId, kind: "UPLOAD" }, bytes]);
});

it("distinguishes a failed preview from an exhausted allowance", async () => {
  const body = { productId, requestId: createUuidV7(), model: "local", placement: { x: 50, y: 50, size: 30 } };
  mock.render.mockRejectedValueOnce(new AppError("PRECONDITION_FAILED", "Render failed.", { photoStatus: "failed" }));
  mock.render.mockRejectedValueOnce(new AppError("PRECONDITION_FAILED", "Allowance exhausted."));
  expect((await POST(request(body))).status).toBe(422);
  expect((await POST(request(body))).status).toBe(412);
  expect(mock.accept).not.toHaveBeenCalled();
});

it("requires a signed-in reviewer or admin to accept a preview", async () => {
  const body = { productId, previewId: createUuidV7() };
  mock.principal.mockResolvedValueOnce(null);
  expect((await POST(request(body))).status).toBe(401);
  mock.principal.mockResolvedValueOnce({ userId: createUuidV7(), role: "OPERATOR" });
  expect((await POST(request(body))).status).toBe(403);
  expect(mock.accept).not.toHaveBeenCalled();
});

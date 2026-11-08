import { describe, expect, it, vi } from "vitest";
import { loadPrincipalByUserId, type AuthenticatedPrincipal } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { MAX_PHOTO_BYTES } from "@khidi/media/contracts";
import { createUuidV7 } from "@khidi/shared";
import { parsePhotoUpload } from "../../../lib/photo-upload-body.ts";
const { session } = vi.hoisted(() => ({ session: { principal: null as AuthenticatedPrincipal | null } }));
vi.mock("../../../lib/session.ts", () => ({ getCurrentPrincipal: async () => session.principal }));
import { POST as upload } from "./uploads/route.ts";
import { GET as capture } from "./capture/route.ts";
import { POST as attention } from "./attention/route.ts";
import { GET as jobs, POST as retry } from "./jobs/route.ts";
import { POST as discard } from "./discards/route.ts";
import { GET as images, POST as manage } from "./images/route.ts";
import { GET as view } from "./view/route.ts";

describe("P3 photo upload HTTP boundary", () => {
  it("requires an authenticated principal before reading a photo body", async () => {
    session.principal = null;
    expect((await upload(new Request("http://localhost/api/media/uploads", { method: "POST", body: "invalid" }))).status).toBe(401);
    expect((await capture(new Request("http://localhost/api/media/capture"))).status).toBe(401);
    expect((await attention(new Request("http://localhost/api/media/attention", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await jobs(new Request("http://localhost/api/media/jobs"))).status).toBe(401);
    expect((await retry(new Request("http://localhost/api/media/jobs", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await discard(new Request("http://localhost/api/media/discards", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await images(new Request("http://localhost/api/media/images"))).status).toBe(401);
    expect((await manage(new Request("http://localhost/api/media/images", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await view(new Request("http://localhost/api/media/view"))).status).toBe(401);
  });
  it("rejects an oversized actual stream even without Content-Length", async () => {
    const admin = await getDb().query.users.findFirst({ where: (user, { eq }) => eq(user.role, "ADMIN") });
    session.principal = await loadPrincipalByUserId(getDb(), admin!.id);
    const response = await upload(new Request("http://localhost/api/media/uploads", { method: "POST", headers: { Origin: "http://localhost:3100", "Content-Type": "multipart/form-data; boundary=limit" }, body: new Uint8Array(MAX_PHOTO_BYTES + 65537) }));
    expect(response.status).toBe(413); expect((await response.json()).error).toContain("15 მბ");
  });
  it("bounds multipart metadata and requires the same header/body idempotency key", async () => {
    const form = new FormData(); form.set("metadata", JSON.stringify({ idempotencyKey: createUuidV7() }));
    form.set("file", new File([new Uint8Array([1])], "photo.jpg", { type: "image/jpeg" }));
    await expect(parsePhotoUpload(new Request("http://localhost/api/media/uploads", { method: "POST", headers: { Origin: "http://localhost:3100", "Idempotency-Key": createUuidV7() }, body: form }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("refuses job administration to a warehouse session before reading a retry body", async () => {
    const user = await getDb().query.users.findFirst({ where: (user, { eq }) => eq(user.role, "WAREHOUSE") });
    session.principal = await loadPrincipalByUserId(getDb(), user!.id);
    expect((await jobs(new Request("http://localhost/api/media/jobs"))).status).toBe(403);
    expect((await retry(new Request("http://localhost/api/media/jobs", { method: "POST", body: "invalid" }))).status).toBe(403);
    expect((await images(new Request("http://localhost/api/media/images"))).status).toBe(403);
    expect((await manage(new Request("http://localhost/api/media/images", { method: "POST", body: "invalid" }))).status).toBe(403);
    expect((await view(new Request("http://localhost/api/media/view"))).status).toBe(403);
  });
});

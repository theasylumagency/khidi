import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrincipalByUserId, webauthnConfig, type AuthenticatedPrincipal } from "@khidi/auth";
import { queueAiJob } from "@khidi/ai";
import { getDb } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { MAX_PHOTO_BYTES, signPrivateMedia } from "@khidi/media";
import { digest, FilesystemMediaStorage, StorageExistsError, type MediaStorage } from "@khidi/media/storage";
import { createSkuDraft, getProductTypeByKey } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { POST as postEvidence } from "./route.ts";
import { GET as viewMedia } from "../media/view/route.ts";
import { POST as updateLifecycle } from "../products/ready/route.ts";

const { session, testStorage } = vi.hoisted(() => ({
  session: { principal: null as AuthenticatedPrincipal | null }, testStorage: { current: null as MediaStorage | null }
}));
vi.mock("../../../lib/session.ts", () => ({ getCurrentPrincipal: async () => session.principal }));
vi.mock("@khidi/media", async (importOriginal) => ({
  ...await importOriginal<typeof import("@khidi/media")>(), getMediaStorage: () => testStorage.current!
}));

it("accepts a multipart inspection and replays evidence and lifecycle requests by key", async () => {
  const db = getDb();
  const admin = await db.query.users.findFirst({ where: (user, { eq }) => eq(user.role, "ADMIN") });
  session.principal = await loadPrincipalByUserId(db, admin!.id);
  const actor = { userId: admin!.id };
  const type = await getProductTypeByKey(db, "MOTOBLOCK");
  const sku = await createSkuDraft(db, actor, { productTypeId: type.id });
  const origin = webauthnConfig().origin;
  const form = new FormData();
  const claims = { wheel_type: "RUBBER" };
  form.set("evidence", JSON.stringify({ action: "submit", skuId: sku.id, type: "ADMIN_PHYSICAL_INSPECTION", notes: "Observed rubber wheels", claims }));
  const submitKey = createUuidV7();
  const submit = () => postEvidence(new Request(`${origin}/api/evidence`, { method: "POST", headers: { Origin: origin, "Idempotency-Key": submitKey }, body: form }));
  const first = await submit();
  expect(first.status).toBe(201);
  const item = await first.json();
  expect(await (await submit()).json()).toEqual(item);
  const review = await postEvidence(new Request(`${origin}/api/evidence`, { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": createUuidV7() },
    body: JSON.stringify({ action: "review", evidenceId: item.id, status: "ACCEPTED", reason: "Confirmed physical inspection", claims }) }));
  expect(review.status).toBe(200);
  const lifecycleKey = createUuidV7();
  const move = () => updateLifecycle(new Request(`${origin}/api/products/ready`, { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": lifecycleKey },
    body: JSON.stringify({ action: "TRANSITION_LIFECYCLE", skuId: sku.id, targetState: "IDENTIFIED" }) }));
  const moved = await move();
  expect(moved.status).toBe(200);
  const result = await moved.json();
  expect(result.sku.lifecycleState).toBe("IDENTIFIED");
  expect(await (await move()).json()).toEqual(result);
});

function blankPdf() {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 120] >>"];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const start = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return start;
  });
  const xref = pdf.length;
  pdf += "xref\n0 4\n0000000000 65535 f \n" + offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return new TextEncoder().encode(pdf + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

it("stores a PDF unchanged as private evidence and serves it only through an admin's signed link", async () => {
  const directory = await mkdtemp(join(tmpdir(), "khidi-evidence-pdf-test-"));
  const storage = new FilesystemMediaStorage(directory);
  testStorage.current = storage;
  try {
    const db = getDb();
    const admin = await db.query.users.findFirst({ where: (user, { eq }) => eq(user.role, "ADMIN") });
    session.principal = await loadPrincipalByUserId(db, admin!.id);
    const actor = { userId: admin!.id };
    const type = await getProductTypeByKey(db, "MOTOBLOCK");
    const sku = await createSkuDraft(db, actor, { productTypeId: type.id });
    const origin = webauthnConfig().origin;
    const pdf = blankPdf(), key = createUuidV7();
    const submit = (file: File, type: string, submissionKey = createUuidV7()) => {
      const form = new FormData();
      form.set("evidence", JSON.stringify({ action: "submit", skuId: sku.id, type }));
      form.set("photo", file);
      return postEvidence(new Request(`${origin}/api/evidence`, {
        method: "POST", headers: { Origin: origin, "Idempotency-Key": submissionKey }, body: form
      }));
    };
    const document = new File([pdf], "specification.pdf", { type: "application/pdf" });
    expect((await submit(document, "PRODUCT_PLATE_PHOTO")).status).toBe(400);
    expect((await submit(new File(["<html>"], "bad.pdf", { type: "application/pdf" }), "FACTORY_SPEC_SHEET")).status).toBe(400);
    expect((await submit(new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], "too-big.pdf", { type: "application/pdf" }), "FACTORY_SPEC_SHEET")).status).toBe(413);
    const created = await submit(document, "FACTORY_SPEC_SHEET", key);
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const [item] = await db.query.evidence.findMany({ where: (record, { eq }) => eq(record.id, id) });
    const objectKey = `evidence/${key}/original.pdf`;
    expect(item).toMatchObject({ sensitivity: "INTERNAL_ONLY", privateStorageKey: objectKey,
      privateMimeType: "application/pdf", privateSha256: digest(pdf), imageId: null });
    await expect(storage.putPrivate(objectKey, pdf, "application/pdf")).rejects.toBeInstanceOf(StorageExistsError);
    await expect(withDomainTransaction(db, actor, (ctx) => queueAiJob(ctx, {
      skuId: sku.id, evidenceId: id, jobName: "extract-evidence"
    }))).rejects.toMatchObject({ code: "FORBIDDEN" });

    const view = (url: string) => viewMedia(new Request(`${origin}${url}`));
    const signed = signPrivateMedia(actor.userId, id, "evidence", 0);
    expect((await view(`/api/media/view?imageId=${id}&variant=evidence&version=0`)).status).toBe(403);
    expect((await view(signPrivateMedia(createUuidV7(), id, "evidence", 0))).status).toBe(403);
    expect((await view(signPrivateMedia(actor.userId, id, "evidence", 0, Date.now() - 301_000))).status).toBe(403);
    const response = await view(signed);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf);
    session.principal = null;
    expect((await view(signed)).status).toBe(401);
  } finally {
    testStorage.current = null;
    await rm(directory, { recursive: true, force: true });
  }
});

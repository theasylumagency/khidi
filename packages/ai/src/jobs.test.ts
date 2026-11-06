import { and, eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { aiJobLogs, aiJobs, auditLogs, evidence, getDb, imageMasterVersions, productImages, users } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { createHash } from "node:crypto";
import { createUuidV7 } from "@khidi/shared";
import { createSkuDraft, getProductTypeByKey } from "@khidi/products";
import { getStorefrontIdentityFacts, reviewSkuEvidence, submitSkuEvidence } from "@khidi/evidence";
import type { MediaStorage } from "@khidi/media/storage";
import { fixturePhoto } from "../../media/src/test-fixtures.ts";
import { executeAiJob, queueAiJob } from "./jobs.ts";
import type { AiProvider } from "./provider.ts";

async function fixture() {
  const db = getDb();
  const [admin] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
  const actor = { userId: admin!.id };
  const productType = await getProductTypeByKey(db, "MOTOBLOCK");
  const sku = await createSkuDraft(db, actor, { productTypeId: productType.id });
  const create = (jobName: Parameters<typeof queueAiJob>[1]["jobName"], target = {}) => withDomainTransaction(db, actor,
    (ctx) => queueAiJob(ctx, { jobName, skuId: sku.id, ...target }));
  return { db, actor, sku, create };
}

function storageWith(readPrivate = vi.fn<MediaStorage["readPrivate"]>()) {
  return { readPrivate, putPrivate: vi.fn(), putPublic: vi.fn(), removePublic: vi.fn() } satisfies MediaStorage;
}

it("uses the processed master for label jobs even when an 800 px derivative exists", async () => {
  const { db, sku, actor, create } = await fixture();
  const imageId = createUuidV7(), bytes = await fixturePhoto(1920, 1920);
  const masterKey = `master/${imageId}/v1/master.jpg`, hash = createHash("sha256").update(bytes).digest("hex");
  await db.insert(productImages).values({ id: imageId, skuId: sku.id, slot: "IDENTIFICATION", rawStorageKey: `raw/${imageId}/original.jpg`,
    rawSha256: "a".repeat(64), rawBytes: 100, mimeType: "image/jpeg", width: 1920, height: 1080, capturedAt: new Date(),
    deviceId: createUuidV7(), idempotencyKey: imageId, requestHash: "b".repeat(64), masterStorageKey: masterKey, masterSha256: hash,
    masterVersion: 1, processingStatus: "COMPLETED", tier1QualityJson: { passed: true }, createdBy: actor.userId });
  await db.insert(imageMasterVersions).values({ id: createUuidV7(), imageId, version: 1, storageKey: masterKey, sha256: hash,
    bytes: bytes.byteLength, width: 1920, height: 1920, derivativesJson: {
      "800.webp": { key: `master/${imageId}/v1/800.webp`, sha256: "d".repeat(64), bytes: 4096, width: 800, format: "webp", contentType: "image/webp" }
    } });
  const target = { imageId, imageVersion: 1 };
  const item = await submitSkuEvidence(db, actor, { skuId: sku.id, imageId, type: "PRODUCT_MARKING_PHOTO", claims: { brand: "TEST-BRAND" } });
  const job = await create("ocr-label", { ...target, evidenceId: item.id });
  const storage = storageWith(vi.fn().mockResolvedValue(bytes));
  const provider: AiProvider = { provider: "synthetic", model: "fixture", reserveCostUsdMicros: () => 0,
    run: vi.fn().mockResolvedValue({ candidates: { brand: "AI-BRAND", model_code: "178FE", wheel_type: "IRON", price: 80, confidence: "HIGH" },
      inputTokens: 10, outputTokens: 5, costUsdMicros: 0 }) };
  await executeAiJob(db, storage, provider, job, 0, 0);
  expect(storage.readPrivate).toHaveBeenCalledExactlyOnceWith(masterKey, hash, undefined);
  expect(provider.run).toHaveBeenCalledOnce();
  expect(provider.run).toHaveBeenCalledWith(expect.objectContaining({ photo: { bytes, mimeType: "image/jpeg" } }));
  const [attempt] = await db.select().from(aiJobLogs).where(eq(aiJobLogs.jobId, job));
  expect(attempt).toMatchObject({ provider: "synthetic", model: "fixture", promptVersion: "evidence-v1", costUsdMicros: 0, status: "SUCCEEDED" });
  const [stored] = await db.select().from(aiJobs).where(eq(aiJobs.id, job));
  expect(stored?.result).toEqual({ candidates: { brand: "AI-BRAND", model_code: "178FE", wheel_type: "IRON" } });
  const [pending] = await db.select().from(evidence).where(eq(evidence.id, item.id));
  expect(pending?.claims).toEqual({ brand: "TEST-BRAND", model_code: "178FE", wheel_type: "IRON" });
  expect(pending?.claimSources).toEqual({
    brand: { origin: "HUMAN", userId: actor.userId }, model_code: { origin: "AI", jobId: job }, wheel_type: { origin: "AI", jobId: job }
  });
  expect((await getStorefrontIdentityFacts(db, sku.id)).fields).toEqual({});
  const review = { evidenceId: item.id, status: "ACCEPTED", reason: "Read the model from the label", confirmedAiFields: ["model_code"] };
  await expect(reviewSkuEvidence(db, actor, { ...review, claims: { ...pending!.claims, model_code: "178F" } }))
    .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const accepted = await reviewSkuEvidence(db, actor, { ...review, claims: pending!.claims });
  expect(accepted.claims).toEqual({ brand: "TEST-BRAND", model_code: "178FE" });
  expect(accepted.claimSources).toEqual({
    brand: { origin: "HUMAN", userId: actor.userId }, model_code: { origin: "AI", jobId: job, confirmedBy: actor.userId }
  });
  expect((await getStorefrontIdentityFacts(db, sku.id)).fields).toEqual({ brand: "TEST-BRAND", model_code: "178FE" });
  const [confirmation] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, item.id), eq(auditLogs.action, "EVIDENCE_AI_CLAIMS_CONFIRMED")));
  expect(confirmation).toMatchObject({ actorUserId: actor.userId, afterJson: { confirmed: [{ field: "model_code", jobId: job, value: "178FE" }] } });
  const blocked = await submitSkuEvidence(db, actor, { skuId: sku.id, imageId, type: "SUPPLIER_DOCUMENT", documentNumber: "ABC", lineText: "Private line" });
  await expect(create("extract-evidence", { ...target, evidenceId: blocked.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await executeAiJob(db, storage, provider, await create("analyze-photo-quality", target), 0, 0);
  expect(provider.run).toHaveBeenCalledOnce();
  expect(storage.readPrivate).toHaveBeenCalledOnce();
});

it("reserves the daily budget atomically across two concurrent jobs", async () => {
  const { db, create } = await fixture();
  const [a, b] = await Promise.all([create("classify-product"), create("identify-product")]);
  const spend = await db.select({ value: sql<string>`COALESCE(SUM(COALESCE(${aiJobLogs.costUsdMicros}, ${aiJobLogs.reservedUsdMicros})), 0)` }).from(aiJobLogs)
    .where(sql`${aiJobLogs.budgetDay} = to_char(now() AT TIME ZONE 'Asia/Tbilisi', 'YYYY-MM-DD')`);
  const cap = Number(spend[0]?.value ?? "0") + 60;
  const provider: AiProvider = { provider: "synthetic", model: "budget-fixture", reserveCostUsdMicros: () => 60,
    run: vi.fn().mockResolvedValue({ candidates: {}, inputTokens: 20, outputTokens: 10, costUsdMicros: 60 }) };
  await Promise.all([executeAiJob(db, storageWith(), provider, a, 0, cap), executeAiJob(db, storageWith(), provider, b, 0, cap)]);
  expect(provider.run).toHaveBeenCalledOnce();
  const rows = await db.select().from(aiJobs).where(and(sql`${aiJobs.id} IN (${a}, ${b})`));
  expect(rows.map((row) => row.status).sort()).toEqual(["BUDGET_BLOCKED", "SUCCEEDED"]);
});

import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb, legalEntities, outboxEvents, productImages, skus, users } from "@khidi/db";
import { decideSkuEvidenceField, getStorefrontIdentityFacts, reviewSkuEvidence, submitSkuEvidence } from "@khidi/evidence";
import { createUuidV7 } from "@khidi/shared";
import { createSkuDraft, getProductTypeByKey, transitionSkuLifecycle, transitionSkuToReady, upsertAccountingMapping, upsertProductType } from "./index.ts";

it("promotes a document-free SKU with explicit MEDIUM confirmation and flags a later conflict without changing READY or slug", async () => {
  const db = getDb();
  const [admin] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
  const [entity] = await db.select().from(legalEntities).limit(1);
  const actor = { userId: admin!.id };
  const template = await getProductTypeByKey(db, "MOTOBLOCK");
  const type = await upsertProductType(db, actor, { ...template, key: `HOUSE_${createUuidV7().slice(-10)}`, nameEn: `House test ${createUuidV7().slice(-10)}`,
    distinguishingAttributes: ["wheel_type", "power_kw"] });
  async function createCandidate() {
    const sku = await createSkuDraft(db, actor, { productTypeId: type.id });
    for (const slot of ["MAIN", "SECONDARY"]) {
      const id = createUuidV7();
      await db.insert(productImages).values({ id, skuId: sku.id, slot, status: "VERIFIED", rawStorageKey: `raw/${id}/fixture.jpg`,
        rawSha256: "a".repeat(64), rawBytes: 1, mimeType: "image/jpeg", width: 1920, height: 1080, capturedAt: new Date(),
        deviceId: createUuidV7(), idempotencyKey: id, requestHash: "b".repeat(64), masterStorageKey: `master/${id}/v1/master.jpg`,
        masterSha256: "c".repeat(64), masterVersion: 1, processingStatus: "COMPLETED", tier1QualityJson: { passed: true },
        createdBy: admin!.id, verifiedBy: admin!.id, verifiedAt: new Date() });
    }
    const claims = { wheel_type: "RUBBER" };
    const inspection = await submitSkuEvidence(db, actor, { skuId: sku.id, type: "ADMIN_PHYSICAL_INSPECTION", notes: "Inspected the actual wheels", claims });
    await reviewSkuEvidence(db, actor, { evidenceId: inspection.id, status: "ACCEPTED", reason: "Confirmed direct inspection", claims });
    await decideSkuEvidenceField(db, actor, { skuId: sku.id, field: "power_kw", reason: "No marking or power test available" });
    await upsertAccountingMapping(db, actor, { skuId: sku.id, legalEntityId: entity!.id, accountingItemId: createUuidV7(), accountingName: "Fixture" });
    await transitionSkuLifecycle(db, actor, sku.id, "IDENTIFIED");
    await transitionSkuLifecycle(db, actor, sku.id, "CONTENT_GENERATING");
    await transitionSkuLifecycle(db, actor, sku.id, "CONTENT_REVIEW");
    return sku;
  }
  const first = await createCandidate();
  await expect(transitionSkuToReady(db, actor, first.id)).rejects.toThrow(/explicit human confirmation/);
  const ready = await transitionSkuToReady(db, actor, first.id, { humanConfirmedMediumConfidence: true });
  expect(ready).toMatchObject({ identityKind: "HOUSE_DEFINED", identityConfidence: "MEDIUM", brand: null, modelCode: null, lifecycleState: "READY" });
  expect(ready.canonicalSlug).not.toContain("kh-");
  const second = await createCandidate();
  await expect(transitionSkuToReady(db, actor, second.id, { humanConfirmedMediumConfidence: true })).rejects.toMatchObject({ code: "CONFLICT" });
  const observed = await submitSkuEvidence(db, actor, { skuId: second.id, type: "ADMIN_PHYSICAL_INSPECTION", comparisonSkuId: first.id,
    notes: "The second machine has an observable different mounting plate.", claims: {} });
  await reviewSkuEvidence(db, actor, { evidenceId: observed.id, status: "ACCEPTED", reason: "Observed both machines", claims: {} });
  expect(await transitionSkuToReady(db, actor, second.id, { humanConfirmedMediumConfidence: true, customCanonicalSlug: "mount-b" }))
    .toMatchObject({ lifecycleState: "READY", identityConfidence: "MEDIUM" });

  const contradictory = await submitSkuEvidence(db, actor, { skuId: first.id, type: "STAFF_STATEMENT", claims: { wheel_type: "IRON" } });
  const [flagged] = await db.select().from(skus).where(eq(skus.id, first.id));
  expect(flagged).toMatchObject({ lifecycleState: "READY", canonicalSlug: ready.canonicalSlug, identityConfidence: "CONFLICT", reverificationRequired: true });
  expect(await getStorefrontIdentityFacts(db, first.id)).toEqual({ identityConflict: true, fields: {} });
  expect(await db.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, first.id), eq(outboxEvents.eventType, "PRODUCT_REVIEW_REQUIRED"))))
    .toHaveLength(1);
  await reviewSkuEvidence(db, actor, { evidenceId: contradictory.id, status: "REJECTED", reason: "Observed rubber wheels" });
  expect(await getStorefrontIdentityFacts(db, first.id)).toEqual({ identityConflict: false, fields: { wheel_type: "RUBBER" } });
});

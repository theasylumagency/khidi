import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { auditLogs, evidence, getDb, legalEntities, outboxEvents, productImages, skuFieldProvenance, skus, users } from "@khidi/db";
import { decideSkuEvidenceField, getStorefrontIdentityFacts, registerObservableAttribute, reviewSkuEvidence, submitSkuEvidence } from "@khidi/evidence";
import { createUuidV7 } from "@khidi/shared";
import { approveCanonicalVersion, createSkuDraft, getProductTypeByKey, saveCanonicalVersion, transitionSkuLifecycle, transitionSkuToReady, upsertAccountingMapping, upsertProductType } from "./index.ts";

it("retains the original reading, freezes decisions in PostgreSQL and supersedes evidence atomically", async () => {
  const db = getDb();
  const [admin] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
  const actor = { userId: admin!.id };
  const productType = await getProductTypeByKey(db, "MOTOBLOCK");
  const sku = await createSkuDraft(db, actor, { productTypeId: productType.id });
  const input = { skuId: sku.id, type: "FACTORY_SPEC_SHEET", claims: { power_kw: 5 } };
  const pending = await submitSkuEvidence(db, actor, input);
  const accept = { evidenceId: pending.id, status: "ACCEPTED", reason: "Corrected the pending reading", claims: { power_kw: 6 } };
  const accepted = await reviewSkuEvidence(db, actor, accept);
  const sources = { power_kw: { origin: "HUMAN", userId: actor.userId } };
  const [acceptance] = await db.select().from(auditLogs)
    .where(and(eq(auditLogs.entityId, pending.id), eq(auditLogs.action, "EVIDENCE_ACCEPTED")));
  expect(acceptance).toMatchObject({
    beforeJson: { claims: { power_kw: 5 }, claimSources: sources }, afterJson: { claims: { power_kw: 6 }, claimSources: sources }
  });
  await expect(reviewSkuEvidence(db, actor, { ...accept, claims: { power_kw: 7 } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(db.update(evidence).set({ claims: { power_kw: 7 } }).where(eq(evidence.id, pending.id))).rejects.toThrow(/Invalid evidence transition/);
  await expect(db.update(evidence).set({ status: "REJECTED", documentNumber: "changed", decisionReason: "Test" })
    .where(eq(evidence.id, pending.id))).rejects.toThrow(/must preserve evidence content/);
  await expect(db.update(evidence).set({ status: "REJECTED", decisionReason: " " })
    .where(eq(evidence.id, pending.id))).rejects.toThrow(/requires a reason/);
  await expect(db.insert(evidence).values({ ...input, id: createUuidV7(), supersedesEvidenceId: pending.id, authorId: actor.userId,
    authorRole: "ADMIN", sensitivity: "AI_ALLOWED", capturedAt: new Date() })).rejects.toThrow(/same transaction/);

  const replacement = await submitSkuEvidence(db, actor, { ...input, supersedesEvidenceId: pending.id,
    supersessionReason: "New supplier revision", claims: { power_kw: 7 } });
  const [retained] = await db.select().from(evidence).where(eq(evidence.id, pending.id));
  expect(retained).toMatchObject({ status: "REJECTED", claims: accepted.claims, claimSources: accepted.claimSources });
  expect(replacement).toMatchObject({ status: "PENDING", supersedesEvidenceId: pending.id });
  expect((await getStorefrontIdentityFacts(db, sku.id)).fields).toEqual({});
  await expect(reviewSkuEvidence(db, actor, accept)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(db.update(evidence).set({ status: "ACCEPTED" }).where(eq(evidence.id, pending.id))).rejects.toThrow(/Invalid evidence transition/);
  const [supersession] = await db.select().from(auditLogs)
    .where(and(eq(auditLogs.entityId, replacement.id), eq(auditLogs.action, "EVIDENCE_SUPERSEDED")));
  expect(supersession).toMatchObject({
    beforeJson: { id: pending.id, status: "ACCEPTED", claims: { power_kw: 6 }, claimSources: sources },
    afterJson: { id: replacement.id, status: "PENDING", supersededStatus: "REJECTED", claims: { power_kw: 7 }, claimSources: sources }
  });
  await reviewSkuEvidence(db, actor, { ...accept, evidenceId: replacement.id, claims: replacement.claims });
  expect((await getStorefrontIdentityFacts(db, sku.id)).fields).toEqual({ power_kw: 7 });
});

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
  const firstContent = await saveCanonicalVersion(db, actor, { skuId: first.id, locale: "ka" });
  await approveCanonicalVersion(db, actor, { skuId: first.id, versionId: firstContent.version.id });
  await expect(transitionSkuToReady(db, actor, first.id)).rejects.toThrow(/explicit human confirmation/);
  const ready = await transitionSkuToReady(db, actor, first.id, { humanConfirmedMediumConfidence: true });
  expect(ready).toMatchObject({ identityKind: "HOUSE_DEFINED", identityConfidence: "MEDIUM", brand: null, modelCode: null, lifecycleState: "READY" });
  expect(ready.canonicalSlug).not.toContain("kh-");
  const second = await createCandidate();
  await expect(transitionSkuToReady(db, actor, second.id, { humanConfirmedMediumConfidence: true })).rejects.toMatchObject({ code: "CONFLICT" });
  const [firstPhoto] = await db.select().from(productImages).where(and(eq(productImages.skuId, first.id), eq(productImages.slot, "MAIN")));
  const [secondPhoto] = await db.select().from(productImages).where(and(eq(productImages.skuId, second.id), eq(productImages.slot, "MAIN")));
  const comparison = { skuId: second.id, type: "ADMIN_PHYSICAL_INSPECTION", comparisonSkuId: first.id,
    imageId: secondPhoto!.id, comparisonImageId: firstPhoto!.id, notes: "Observed the mounting plates on both machines." };
  for (const claims of [{}, { wheel_type: "RUBBER" }]) {
    await expect(submitSkuEvidence(db, actor, { ...comparison, claims, comparisonClaims: claims }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  }
  await expect(db.insert(evidence).values({ ...comparison, id: createUuidV7(), authorId: actor.userId, authorRole: "ADMIN",
    sensitivity: "INTERNAL_ONLY", capturedAt: new Date(), claims: { wheel_type: "RUBBER" },
    comparisonClaims: { wheel_type: "RUBBER" }, comparisonClaimSources: {} })).rejects.toThrow(/different observable values/);
  await expect(transitionSkuToReady(db, actor, second.id, { humanConfirmedMediumConfidence: true })).rejects.toMatchObject({ code: "CONFLICT" });
  const claims = { mounting_pattern: "Curved" }, comparisonClaims = { mounting_pattern: "Straight" };
  await expect(submitSkuEvidence(db, actor, { ...comparison, claims, comparisonClaims })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await registerObservableAttribute(db, actor, { productTypeId: type.id, key: "mounting_pattern", labelKa: "სამაგრის ფორმა",
    labelEn: "Mounting pattern", reason: "The shape is visible on both machines." });
  expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, type.id),
    eq(auditLogs.action, "PRODUCT_TYPE_OBSERVABLE_ATTRIBUTE_REGISTERED")))).toHaveLength(1);
  await expect(submitSkuEvidence(db, actor, { ...comparison, comparisonImageId: secondPhoto!.id, claims, comparisonClaims }))
    .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const observed = await submitSkuEvidence(db, actor, { ...comparison, claims, comparisonClaims });
  await expect(transitionSkuToReady(db, actor, second.id, { humanConfirmedMediumConfidence: true })).rejects.toMatchObject({ code: "CONFLICT" });
  const review = { evidenceId: observed.id, status: "ACCEPTED", reason: "Observed both machines", claims };
  await expect(reviewSkuEvidence(db, actor, { ...review, comparisonClaims: { mounting_pattern: " curved " } }))
    .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await reviewSkuEvidence(db, actor, { ...review, comparisonClaims });
  const projected = await db.select().from(skuFieldProvenance).where(eq(skuFieldProvenance.fieldName, "mounting_pattern"));
  expect(projected).toEqual(expect.arrayContaining([
    expect.objectContaining({ skuId: first.id, value: "Straight", status: "VERIFIED", evidenceIds: [observed.id] }),
    expect.objectContaining({ skuId: second.id, value: "Curved", status: "VERIFIED", evidenceIds: [observed.id] })
  ]));
  const secondContent = await saveCanonicalVersion(db, actor, { skuId: second.id, locale: "ka" });
  await approveCanonicalVersion(db, actor, { skuId: second.id, versionId: secondContent.version.id });
  expect(await transitionSkuToReady(db, actor, second.id, { humanConfirmedMediumConfidence: true, customCanonicalSlug: "mount-b" }))
    .toMatchObject({ lifecycleState: "READY", identityConfidence: "MEDIUM" });

  const contradictory = await submitSkuEvidence(db, actor, { skuId: first.id, type: "STAFF_STATEMENT", claims: { wheel_type: "IRON" } });
  const [flagged] = await db.select().from(skus).where(eq(skus.id, first.id));
  expect(flagged).toMatchObject({ lifecycleState: "READY", canonicalSlug: ready.canonicalSlug, identityConfidence: "CONFLICT", reverificationRequired: true });
  expect(await getStorefrontIdentityFacts(db, first.id)).toEqual({ identityConflict: true, fields: { mounting_pattern: "Straight" } });
  const notices = await db.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, first.id), eq(outboxEvents.eventType, "PRODUCT_REVIEW_REQUIRED")));
  expect(notices.filter((notice) => notice.payloadJson.reason === "IDENTITY_REVERIFICATION")).toHaveLength(1);
  expect(notices.filter((notice) => notice.payloadJson.reason === "CONTENT_FACT_CHANGED")).toHaveLength(1);
  await reviewSkuEvidence(db, actor, { evidenceId: contradictory.id, status: "REJECTED", reason: "Observed rubber wheels" });
  expect(await getStorefrontIdentityFacts(db, first.id)).toEqual({ identityConflict: false, fields: { wheel_type: "RUBBER", mounting_pattern: "Straight" } });
  await reviewSkuEvidence(db, actor, { evidenceId: observed.id, status: "REJECTED", reason: "Comparison requires a new inspection." });
  expect((await getStorefrontIdentityFacts(db, first.id)).fields).toEqual({ wheel_type: "RUBBER" });
  expect((await getStorefrontIdentityFacts(db, second.id)).fields).toEqual({ wheel_type: "RUBBER" });
});

import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb, outboxEvents, skuContentVersions, skus, users } from "@khidi/db";
import { reviewSkuEvidence, submitSkuEvidence } from "@khidi/evidence";
import { approveCanonicalVersion, createSkuDraft, getCanonicalContentReview, getProductTypeByKey, saveCanonicalVersion } from "./index.ts";

it("rejects unsupported facts and preserves approved immutable content when its evidence changes", async () => {
  const db = getDb();
  const [admin] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
  const actor = { userId: admin!.id };
  const type = await getProductTypeByKey(db, "MOTOBLOCK");
  const sku = await createSkuDraft(db, actor, { productTypeId: type.id });
  const claims = { power_kw: 5, brand: "FIXTUREBRAND" };
  const item = await submitSkuEvidence(db, actor, { skuId: sku.id, type: "FACTORY_SPEC_SHEET", claims });
  await reviewSkuEvidence(db, actor, { evidenceId: item.id, status: "ACCEPTED", reason: "Synthetic sheet", claims });
  const generated = await saveCanonicalVersion(db, actor, { skuId: sku.id, locale: "ka" });
  expect(generated.issues).toEqual([]);
  const bad = await saveCanonicalVersion(db, actor, { skuId: sku.id, locale: "ka", draft: {
    displayName: generated.version.displayName, shortDescription: "UNVERIFIEDBRAND 9 kW",
    fullDescription: generated.version.fullDescription, searchAliases: []
  } });
  await expect(approveCanonicalVersion(db, actor, { skuId: sku.id, versionId: bad.version.id })).rejects.toMatchObject({
    code: "VALIDATION_ERROR", details: { issues: expect.arrayContaining([
      expect.objectContaining({ phrase: "UNVERIFIEDBRAND" }), expect.objectContaining({ phrase: "9" })
    ]) }
  });
  await approveCanonicalVersion(db, actor, { skuId: sku.id, versionId: generated.version.id });
  await expect(db.update(skuContentVersions).set({ fullDescription: "changed" }).where(eq(skuContentVersions.id, generated.version.id))).rejects.toThrow();
  const revision = await submitSkuEvidence(db, actor, { skuId: sku.id, type: "FACTORY_SPEC_SHEET", claims: { power_kw: 7, brand: "FIXTUREBRAND" },
    supersedesEvidenceId: item.id, supersessionReason: "New synthetic revision" });
  await reviewSkuEvidence(db, actor, { evidenceId: revision.id, status: "ACCEPTED", reason: "Read the revision", claims: revision.claims });
  const [updated] = await db.select().from(skus).where(eq(skus.id, sku.id));
  expect(updated).toMatchObject({ contentReviewRequired: true, fullDescriptionKa: generated.version.fullDescription });
  expect((await getCanonicalContentReview(db, sku.id)).approved[0]).toMatchObject({ id: generated.version.id, changedFields: ["power_kw"], conflictingFields: [] });
  const notices = await db.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, sku.id), eq(outboxEvents.eventType, "PRODUCT_REVIEW_REQUIRED")));
  expect(notices).toEqual(expect.arrayContaining([expect.objectContaining({ payloadJson: expect.objectContaining({
    severity: "ACTION_REQUIRED", reason: "CONTENT_FACT_CHANGED", locales: ["ka"]
  }) })]));
});

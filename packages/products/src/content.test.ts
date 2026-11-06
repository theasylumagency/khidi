import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb, outboxEvents, skuContentVersions, skus, users } from "@khidi/db";
import { reviewSkuEvidence, submitSkuEvidence } from "@khidi/evidence";
import { createUuidV7 } from "@khidi/shared";
import { approveCanonicalVersion, createSkuDraft, getCanonicalContentReview, getProductTypeByKey, getTechnicalSynonyms,
  saveCanonicalVersion, saveTechnicalSynonyms, upsertAccountingMapping } from "./index.ts";

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
    displayName: generated.version.displayName, shortDescription: "9 kW; -5 kW",
    fullDescription: generated.version.fullDescription, searchAliases: []
  } });
  await expect(approveCanonicalVersion(db, actor, { skuId: sku.id, versionId: bad.version.id })).rejects.toMatchObject({
    code: "VALIDATION_ERROR", details: { issues: expect.arrayContaining([
      expect.objectContaining({ phrase: "9 kW" }), expect.objectContaining({ phrase: "-5 kW" })
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

it("allows ordinary copy and blocks exactly the configured factual and confidentiality violations at approval", async () => {
  const db = getDb();
  const [admin, operator, storefront, type] = await Promise.all([
    db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "ADMIN") }),
    db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "OPERATOR") }),
    db.query.storefronts.findFirst(), getProductTypeByKey(db, "MOTOBLOCK")
  ]);
  const actor = { userId: admin!.id };
  const sku = await createSkuDraft(db, actor, { productTypeId: type.id });
  const other = await createSkuDraft(db, actor, { productTypeId: type.id });
  const claims = { power_kw: 6.62, brand: "Golden Tractor", model_code: "D178E-DF900Q", transmission_gears: "4" };
  const accepted = await submitSkuEvidence(db, actor, { skuId: sku.id, type: "FACTORY_SPEC_SHEET", claims });
  await reviewSkuEvidence(db, actor, { evidenceId: accepted.id, status: "ACCEPTED", reason: "Fixture facts", claims });
  const otherBrand = await submitSkuEvidence(db, actor, { skuId: other.id, type: "FACTORY_SPEC_SHEET", claims: { brand: "Northwind Iron" } });
  await reviewSkuEvidence(db, actor, { evidenceId: otherBrand.id, status: "ACCEPTED", reason: "Fixture brand", claims: otherBrand.claims });
  const itemId = `ITEM-${createUuidV7().slice(-8)}`;
  await upsertAccountingMapping(db, actor, { skuId: other.id, legalEntityId: storefront!.sellerEntityId,
    accountingItemId: itemId, accountingName: "განსაკუთრებული შიდა აღრიცხვა" });
  await submitSkuEvidence(db, actor, { skuId: other.id, type: "SUPPLIER_DOCUMENT", supplierName: "Private Timber Trading",
    documentNumber: "SUPDOC/7781", lineText: "Fixture reference only" });

  const save = (text: string) => saveCanonicalVersion(db, actor, { skuId: sku.id, locale: "ka",
    draft: { displayName: "Golden Tractor D178E-DF900Q", shortDescription: text, fullDescription: text, searchAliases: ["საკაიფო ხელსაწყო"] } });
  const approve = (id: string) => approveCanonicalVersion(db, actor, { skuId: sku.id, versionId: id });
  const approved = await save("ეს მაგარი რამეა, motobloki 好用. 2026-ში D178E-DF900Q-ის ნახვა შეიძლება. 9-ცხენიანი და 4-სიჩქარიანი.");
  expect(approved.issues).toEqual([]);
  expect(approved.version.verifiedFacts).toMatchObject({ ...claims, transmission_gears: 4 });
  await approve(approved.version.id);
  for (const [phrase, code] of [
    ["7 hp", "UNVERIFIED_TECHNICAL_VALUE"], ["8-ცხენიანი", "UNVERIFIED_TECHNICAL_VALUE"],
    ["178FE", "UNVERIFIED_MODEL"], ["D178E-DF901Q", "UNVERIFIED_MODEL"], ["Northwind Iron", "UNVERIFIED_BRAND"],
    [sku.internalSku, "INTERNAL_TEXT"], [itemId, "INTERNAL_TEXT"], ["განსაკუთრებული შიდა აღრიცხვა", "INTERNAL_TEXT"],
    ["Private Timber Trading", "INTERNAL_TEXT"], ["SUPDOC/7781", "INTERNAL_TEXT"], ["app.khidi.app", "INTERNAL_TEXT"],
    ["120 ₾", "INTERNAL_TEXT"], ["USD 30", "INTERNAL_TEXT"], ["$19", "INTERNAL_TEXT"], ["¥ 50", "INTERNAL_TEXT"], ["45 CNY", "INTERNAL_TEXT"]
  ]) {
    const version = await save(phrase!);
    await expect(approve(version.version.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR",
      details: { issues: expect.arrayContaining([expect.objectContaining({ field: "shortDescription", code, phrase })]) } });
  }

  const before = await getTechnicalSynonyms(db);
  await expect(saveTechnicalSynonyms(db, { userId: operator!.id }, { hp: ["poni"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  try {
    await saveTechnicalSynonyms(db, actor, { ...before, hp: ["poni"] });
    const custom = await save("კარგი რამეა — 9 poni");
    expect(custom.version.verifiedFacts.power_kw).toBe(6.62);
    await approve(custom.version.id);
    expect((await save("კარგი რამეა — 8 poni")).issues).toContainEqual({
      field: "shortDescription", code: "UNVERIFIED_TECHNICAL_VALUE", phrase: "8 poni"
    });
  } finally {
    await saveTechnicalSynonyms(db, actor, before);
  }
});

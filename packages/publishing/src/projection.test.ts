import { expect, it } from "vitest";
import { getDb, productImages } from "../../db/src/index.ts";
import { getApprovedContent, getContentFactFields, reviewSkuEvidence, setSkuIdentityKind, submitSkuEvidence } from "@khidi/evidence";
import { approveCanonicalVersion, createSkuDraft, getProductTypeByKey, listSkusWorkspace, normalizePowerToKw, saveCanonicalVersion, setStorefrontListing,
  transitionSkuLifecycle, transitionSkuToReady, upsertAccountingMapping } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { getSkuPublicationReview, getStorefrontProductProjection } from "./index.ts";

it("suspends only locales whose approved content cites a conflicting, changed or unverified fact", async () => {
  const db = getDb();
  const [admin, storefront, type] = await Promise.all([
    db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "ADMIN") }),
    db.query.storefronts.findFirst(), getProductTypeByKey(db, "MOTOBLOCK")
  ]);
  const actor = { userId: admin!.id };
  const sku = await createSkuDraft(db, actor, { productTypeId: type.id });
  const claims = { brand: "FIXTUREBRAND", model_code: `P-${createUuidV7().slice(-8)}` };
  const sheet = await submitSkuEvidence(db, actor, { skuId: sku.id, type: "FACTORY_SPEC_SHEET", claims });
  await reviewSkuEvidence(db, actor, { evidenceId: sheet.id, status: "ACCEPTED", reason: "Synthetic sheet", claims });
  await setSkuIdentityKind(db, actor, sku.id, "MANUFACTURER_IDENTIFIED", "Verified fixture identity");
  const wheel = await submitSkuEvidence(db, actor, { skuId: sku.id, type: "ADMIN_PHYSICAL_INSPECTION",
    claims: { wheel_type: "RUBBER" }, notes: "Observed fixture wheels" });
  await reviewSkuEvidence(db, actor, { evidenceId: wheel.id, status: "ACCEPTED", reason: "Reviewed wheels", claims: wheel.claims });
  const power = await submitSkuEvidence(db, actor, { skuId: sku.id, type: "FACTORY_SPEC_SHEET",
    claims: { power_kw: normalizePowerToKw("7 HP").valueKw } });
  await reviewSkuEvidence(db, actor, { evidenceId: power.id, status: "ACCEPTED", reason: "Reviewed 7 HP rating", claims: power.claims });
  await upsertAccountingMapping(db, actor, { skuId: sku.id, legalEntityId: storefront!.sellerEntityId,
    accountingItemId: createUuidV7(), accountingName: "Fixture mapping" });
  for (const state of ["IDENTIFIED", "CONTENT_GENERATING", "CONTENT_REVIEW"] as const) {
    await transitionSkuLifecycle(db, actor, sku.id, state);
  }
  const ka = await saveCanonicalVersion(db, actor, { skuId: sku.id, locale: "ka" });
  await approveCanonicalVersion(db, actor, { skuId: sku.id, versionId: ka.version.id });
  await transitionSkuToReady(db, actor, sku.id);
  await setStorefrontListing(db, actor, { skuId: sku.id, storefrontId: storefront!.id, enabled: true, reason: "Fixture listing" });
  const imageId = createUuidV7();
  await db.insert(productImages).values({ id: imageId, skuId: sku.id, slot: "MAIN", role: "MAIN", usage: "PUBLIC", status: "VERIFIED",
    rawStorageKey: `raw/${imageId}/original.jpg`, rawSha256: "a".repeat(64), rawBytes: 100, mimeType: "image/jpeg", width: 1920,
    height: 1080, capturedAt: new Date(), deviceId: createUuidV7(), idempotencyKey: imageId, requestHash: "b".repeat(64),
    tier1QualityJson: { passed: true }, createdBy: admin!.id, verifiedBy: admin!.id, verifiedAt: new Date(),
    processingStatus: "COMPLETED", masterVersion: 1, masterStorageKey: `master/${imageId}/1.jpg`, masterSha256: "c".repeat(64) });
  const project = (locale: string) => getStorefrontProductProjection(db, { skuId: sku.id, storefrontId: storefront!.id, locale });
  const englishStatus = async () => (await listSkusWorkspace(db)).find((row) => row.id === sku.id)?.englishContentStatus;
  expect(await englishStatus()).toBe("missing");
  expect(await project("en")).toBeNull();
  const first = await project("ka");
  expect(first).toMatchObject({ locale: "ka", sellable: false, blockingReasons: [
    "ALLOCATION_OWNERS_UNAVAILABLE_M8", "STOREFRONT_PRICING_UNAVAILABLE_M7"
  ], fields: { ...claims, wheel_type: "RUBBER" } });
  expect(Object.keys(first!)).toEqual(["slug", "locale", "displayName", "shortDescription", "fullDescription", "fields", "media", "sellable", "blockingReasons"]);
  expect(JSON.stringify(first)).not.toMatch(/KH-\d|khidi\.app|supplier|accountingItem|raw\//i);

  const title = `${claims.brand} ${claims.model_code} — ${type.nameEn}`;
  const en = await saveCanonicalVersion(db, actor, { skuId: sku.id, locale: "en",
    draft: { displayName: title, shortDescription: title, fullDescription: title, searchAliases: [] } });
  expect(await englishStatus()).toBe("pending");
  expect(await project("en")).toBeNull();
  await approveCanonicalVersion(db, actor, { skuId: sku.id, versionId: en.version.id });
  expect(await englishStatus()).toBe("approved");
  const conflict = await submitSkuEvidence(db, actor, { skuId: sku.id, type: "STAFF_STATEMENT", claims: { wheel_type: "IRON" } });
  expect(await project("ka")).toBeNull();
  expect(await project("en")).toMatchObject({ locale: "en", fullDescription: title, fields: claims });
  expect((await project("en"))?.fields).not.toHaveProperty("wheel_type");
  await reviewSkuEvidence(db, actor, { evidenceId: conflict.id, status: "REJECTED", reason: "Verified fixture wheels" });
  expect(await project("ka")).toEqual(first);
  const changed = await submitSkuEvidence(db, actor, { skuId: sku.id, type: "ADMIN_PHYSICAL_INSPECTION",
    notes: "Rechecked fixture wheels", claims: { wheel_type: "IRON" }, supersedesEvidenceId: wheel.id, supersessionReason: "Corrected observation" });
  await reviewSkuEvidence(db, actor, { evidenceId: changed.id, status: "ACCEPTED", reason: "Rechecked fixture wheels", claims: changed.claims });
  expect(await project("ka")).toBeNull();
  const seven = await saveCanonicalVersion(db, actor, { skuId: sku.id, locale: "ka" });
  await approveCanonicalVersion(db, actor, { skuId: sku.id, versionId: seven.version.id });
  expect((await project("ka"))?.fullDescription).toContain("7 ცხ.ძ.");

  const nineKw = normalizePowerToKw("9 HP").valueKw;
  const replacement = await submitSkuEvidence(db, actor, { skuId: sku.id, type: "FACTORY_SPEC_SHEET",
    claims: { power_kw: nineKw }, supersedesEvidenceId: power.id, supersessionReason: "Corrected factory rating" });
  await reviewSkuEvidence(db, actor, { evidenceId: replacement.id, status: "ACCEPTED", reason: "Reviewed 9 HP rating", claims: replacement.claims });
  expect((await getContentFactFields(db, sku.id)).get("power_kw")).toMatchObject({ status: "VERIFIED", value: nineKw });
  expect(await project("ka")).toBeNull();
  expect(await project("en")).toMatchObject({ locale: "en", fullDescription: title, fields: { power_kw: nineKw } });
  expect(await getSkuPublicationReview(db, sku.id)).toContainEqual(expect.objectContaining({
    storefrontId: storefront!.id, locale: "ka", publishReady: false, publicationBlockers: ["LOCALE_CONTENT_FACT_CHANGED"]
  }));
  const retained = await db.query.skus.findFirst({ where: (row, { eq }) => eq(row.id, sku.id) });
  expect(retained).toMatchObject({ lifecycleState: "READY", canonicalSlug: first!.slug, contentReviewRequired: true });
  expect((await getApprovedContent(db, sku.id)).find(({ version }) => version.locale === "ka")?.version)
    .toMatchObject({ id: seven.version.id, fullDescription: seven.version.fullDescription, verifiedFacts: { power_kw: power.claims.power_kw } });

  const nine = await saveCanonicalVersion(db, actor, { skuId: sku.id, locale: "ka" });
  await approveCanonicalVersion(db, actor, { skuId: sku.id, versionId: nine.version.id });
  expect((await project("ka"))?.fullDescription).toContain("9 ცხ.ძ.");
  expect(await db.query.skuContentVersions.findFirst({ where: (row, { eq }) => eq(row.id, seven.version.id) }))
    .toMatchObject({ fullDescription: seven.version.fullDescription });
  await reviewSkuEvidence(db, actor, { evidenceId: replacement.id, status: "REJECTED", reason: "Factory rating needs reconfirmation" });
  expect(await project("ka")).toBeNull();
  expect((await project("en"))?.fields).not.toHaveProperty("power_kw");

  const withoutPower = await saveCanonicalVersion(db, actor, { skuId: sku.id, locale: "ka" });
  await approveCanonicalVersion(db, actor, { skuId: sku.id, versionId: withoutPower.version.id });
  expect(await project("ka")).toMatchObject({ displayName: withoutPower.version.displayName });
  await submitSkuEvidence(db, actor, { skuId: sku.id, type: "SUPPLIER_DOCUMENT", supplierName: withoutPower.version.displayName,
    documentNumber: "PROJECTION-CONFIDENTIAL-FIXTURE", lineText: "Synthetic supplier reference" });
  expect(await project("ka")).toBeNull();
  expect(await project("en")).toMatchObject({ locale: "en", fullDescription: title });
});

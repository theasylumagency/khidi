import { expect, it } from "vitest";
import { getDb, productImages } from "../../db/src/index.ts";
import { reviewSkuEvidence, setSkuIdentityKind, submitSkuEvidence } from "@khidi/evidence";
import { approveCanonicalVersion, createSkuDraft, getProductTypeByKey, listSkusWorkspace, saveCanonicalVersion, setStorefrontListing,
  transitionSkuLifecycle, transitionSkuToReady, upsertAccountingMapping } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { getStorefrontProductProjection } from "./index.ts";

it("publishes only approved locales and suspends the locale that cites a conflicting fact", async () => {
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
  expect(await project("ka")).toMatchObject({ fullDescription: first!.fullDescription, fields: { wheel_type: "IRON" } });
  await submitSkuEvidence(db, actor, { skuId: sku.id, type: "SUPPLIER_DOCUMENT", supplierName: first!.displayName,
    documentNumber: "PROJECTION-CONFIDENTIAL-FIXTURE", lineText: "Synthetic supplier reference" });
  expect(await project("ka")).toBeNull();
  expect(await project("en")).toMatchObject({ locale: "en", fullDescription: title });
});

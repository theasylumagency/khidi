import { expect, it } from "vitest";
import { getDb, imageMasterVersions, productImages } from "../../db/src/index.ts";
import { createSkuDraft } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { manageImage } from "@khidi/media";
import { loadPrincipalByUserId } from "../../auth/src/index.ts";
import { evaluateSkuMediaSellability } from "./index.ts";
it("derives verified PUBLIC MAIN eligibility from persisted admin decisions", async () => {
  const db = getDb(), user = await db.query.users.findFirst({ where: (user, { eq }) => eq(user.role, "ADMIN") });
  const principal = await loadPrincipalByUserId(db, user!.id), skuId = (await createSkuDraft(db, { userId: user!.id }, {})).id;
  const facts = { lifecycleState: "READY" as const, canonicalSlug: "neutral-product", hasActiveSellerAccountingMapping: true, hasStorefrontAllocation:true, requiresOwnerAccountingMapping: false, hasActiveOwnerAccountingMapping: false, hasCurrentBasePrice: true, isStorefrontListingEnabled: true, hasApprovedLocaleContent: true };
  expect((await evaluateSkuMediaSellability(db, skuId, facts)).blockingReasons).toEqual(["MISSING_VERIFIED_PUBLIC_MAIN_IMAGE"]);
  const id = createUuidV7(), key = `master/${id}/v1/master.jpg`;
  await db.insert(productImages).values({ id, skuId, slot: "MAIN", role: "MAIN", usage: "PUBLIC", rawStorageKey: `raw/${id}/original.jpg`, rawSha256: "a".repeat(64), rawBytes: 123,
    width: 1920, height: 1280, mimeType: "image/jpeg", capturedAt: new Date(), deviceId: createUuidV7(), idempotencyKey: id, requestHash: "b".repeat(64), tier1QualityJson: { passed: true }, createdBy: user!.id,
    masterStorageKey: key, masterSha256: "c".repeat(64), masterVersion: 1, processingStatus: "COMPLETED" });
  await db.insert(imageMasterVersions).values({ id: createUuidV7(), imageId: id, version: 1, storageKey: key, sha256: "c".repeat(64), bytes: 123, width: 1920, height: 1920, derivativesJson: {} });
  await manageImage(db, principal, { idempotencyKey: createUuidV7(), imageId: id, action: "VERIFY" });
  expect((await evaluateSkuMediaSellability(db, skuId, facts)).sellable).toBe(true);
  await manageImage(db, principal, { idempotencyKey: createUuidV7(), imageId: id, action: "UPDATE", usage: "INTERNAL_EVIDENCE" });
  expect((await evaluateSkuMediaSellability(db, skuId, facts)).sellable).toBe(false);
});

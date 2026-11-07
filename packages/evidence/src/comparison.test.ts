import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb, productImages, users } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import { createSkuDraft, getProductTypeByKey, upsertProductType } from "../../products/src/index.ts";
import { reviewSkuEvidence, submitSkuEvidence } from "./registry.ts";

it("uses the same immutable comparison structure for matching and differing observations", async () => {
  const db = getDb();
  const [admin] = await db.select().from(users).where(eq(users.role, "ADMIN"));
  const actor = { userId: admin!.id };
  const template = await getProductTypeByKey(db, "MOTOBLOCK");
  const type = await upsertProductType(db, actor, {
    ...template, key: "CMP_" + createUuidV7().slice(-9), distinguishingAttributes: ["wheel_type", "power_kw"]
  });
  const left = await createSkuDraft(db, actor, { productTypeId: type.id });
  const right = await createSkuDraft(db, actor, { productTypeId: type.id });
  async function photo(skuId: string) {
    const id = createUuidV7();
    await db.insert(productImages).values({
      id, skuId, slot: "MAIN", status: "VERIFIED", rawStorageKey: "raw/" + id + "/fixture.jpg",
      rawSha256: "a".repeat(64), rawBytes: 1, mimeType: "image/jpeg", width: 1920, height: 1080,
      capturedAt: new Date(), deviceId: createUuidV7(), idempotencyKey: id, requestHash: "b".repeat(64),
      masterStorageKey: "master/" + id + "/1.jpg", masterSha256: "c".repeat(64), masterVersion: 1,
      tier1QualityJson: { passed: true }, createdBy: admin!.id, verifiedBy: admin!.id, verifiedAt: new Date()
    });
    return id;
  }
  const input = {
    skuId: left.id, comparisonSkuId: right.id, type: "ADMIN_PHYSICAL_INSPECTION", comparisonRelation: "MATCHES",
    claims: { wheel_type: "RUBBER" }, comparisonClaims: { wheel_type: "RUBBER" },
    imageId: await photo(left.id), comparisonImageId: await photo(right.id),
    notes: "Inspected both fixtures from the same angle", acknowledgedUnknowns: { power_kw: "Both ratings are absent" }
  };
  await expect(submitSkuEvidence(db, actor, { ...input, comparisonClaims: {} })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(submitSkuEvidence(db, actor, { ...input, comparisonClaims: { wheel_type: "IRON" } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const item = await submitSkuEvidence(db, actor, input);
  await reviewSkuEvidence(db, actor, {
    evidenceId: item.id, status: "ACCEPTED", claims: item.claims, reason: "Confirmed both wheel readings"
  });
  expect((await db.query.evidence.findFirst({ where: (row, { eq }) => eq(row.id, item.id) }))?.comparisonRelation).toBe("MATCHES");
});

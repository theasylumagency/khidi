import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { auditLogs, getDb, outboxEvents, productImages, skus, storefrontPrices } from "@khidi/db";
import { createSkuDraft, getProductTypeByKey, mergeSkus, transitionSkuLifecycle, upsertProductType } from "@khidi/products";
import { splitSku } from "@khidi/products/corrections";
import { makeSamenessFixture } from "../../products/src/sameness.test-fixture.ts";
import { createUuidV7 } from "@khidi/shared";
import { getCorrectionPriceImpact, getCurrentPrice, getPriceHistory, previewPriceChanges, setPrice, withdrawPrice } from "./index.ts";

const db = getDb();
async function fixture() {
  const admin = (await db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "ADMIN") }))!;
  const stores = await db.query.storefronts.findMany({ limit: 2 });
  const actor = { userId: admin.id };
  // Existing split targets can predate the source; both operations must use the same lock order.
  const target = await createSkuDraft(db, actor, {}), source = await createSkuDraft(db, actor, {});
  for (const store of stores) await setPrice(db, actor, { skuId: source.id, storefrontId: store.id, basePriceMinor: 10000, vatIncluded: false });
  await setPrice(db, actor, { skuId: target.id, storefrontId: stores[0]!.id, basePriceMinor: 40000 });
  return { actor, stores, source, target };
}
async function assertWithdrawals(skuId: string, reason: string) {
  const rows = await db.select().from(storefrontPrices).where(and(eq(storefrontPrices.skuId, skuId), eq(storefrontPrices.kind, "WITHDRAWN")));
  expect(rows).toHaveLength(2);
  expect(rows[0]!.batchId).toBeTruthy();
  expect(new Set(rows.map((row) => row.batchId)).size).toBe(1);
  for (const row of rows) {
    expect(row).toMatchObject({ kind: "WITHDRAWN", basePriceMinor: null, reason, source: "MANUAL", vatIncluded: false });
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, row.id))).toHaveLength(1);
    expect(await db.select().from(outboxEvents).where(sql`${outboxEvents.payloadJson}->>'priceId' = ${row.id}`))
      .toMatchObject([{ eventType: "PRICE_CHANGED", payloadJson: { batchId: row.batchId, kind: "WITHDRAWN" } }]);
    expect(await getCurrentPrice(db, skuId, row.storefrontId)).toBeNull();
  }
}
it("rejects every price change and preview for an archived SKU", async () => {
  const f = await fixture();
  const change = { skuId: f.source.id, storefrontId: f.stores[0]!.id, basePriceMinor: 11000 };
  const before = await getPriceHistory(db, f.actor, f.source.id);
  await transitionSkuLifecycle(db, f.actor, f.source.id, "ARCHIVED", { reason: "Archived fixture" });
  await expect(setPrice(db, f.actor, change)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(withdrawPrice(db, f.actor, change, "Manual withdrawal")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(previewPriceChanges(db, f.actor, { changes: [change] })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(db.insert(storefrontPrices).values({ ...before[0]!.price, id: createUuidV7(), setAt: new Date() })).rejects.toMatchObject({cause:{message:expect.stringMatching(/Archived/)}});
  expect(await getPriceHistory(db, f.actor, f.source.id)).toEqual(before);
});
it("withdraws merge-source prices atomically without copying them to the survivor", async () => {
  const f = await fixture();
  const sameness = await makeSamenessFixture(db, f.actor, f.source.id, f.target.id);
  const input = { sourceSkuId: f.source.id, targetSkuId: f.target.id, samenessEvidenceId: sameness.id, identityConfirmed: true, reason: "Same physical variant" };
  const impact = await getCorrectionPriceImpact(db, f.actor, f.source.id, [f.target.id]);
  expect(impact.sourcePrices).toHaveLength(2);
  expect(impact.pricedStorefrontsBySku[f.target.id]).toEqual([f.stores[0]!.id]);
  await expect(db.transaction(async (tx) => { await mergeSkus(tx, f.actor, input); throw new Error("Rollback correction fixture"); })).rejects.toThrow("Rollback correction fixture");
  expect((await getPriceHistory(db, f.actor, f.source.id)).map((row) => row.price.kind)).toEqual(["SET", "SET"]);
  await mergeSkus(db, f.actor, input);
  await assertWithdrawals(f.source.id, "SKU merged");
  expect(await getCurrentPrice(db, f.target.id, f.stores[0]!.id)).toMatchObject({ basePriceMinor: 40000 });
  expect(await getCurrentPrice(db, f.target.id, f.stores[1]!.id)).toBeNull();
});
it("withdraws split-source prices atomically and leaves existing/new target prices independent", async () => {
  const f = await fixture();
  const template = await getProductTypeByKey(db, "MOTOBLOCK");
  const type = await upsertProductType(db, f.actor, { ...template, key: "PRICE_SPLIT_" + createUuidV7().slice(-9), distinguishingAttributes: ["wheel_type"] });
  // Synthetic fixtures establish the type before the correction is submitted.
  await db.update(skus).set({ productTypeId: type.id }).where(sql`${skus.id} IN (${f.source.id}::uuid, ${f.target.id}::uuid)`);
  const photos: string[] = [];
  for (let index = 0; index < 2; index++) {
    const id = createUuidV7(); photos.push(id);
    await db.insert(productImages).values({ id, skuId: f.source.id, slot: "MAIN", role: "IDENTITY", usage: "INTERNAL_EVIDENCE", status: "VERIFIED",
      rawStorageKey: "raw/" + id + "/fixture.jpg", rawSha256: "a".repeat(64), rawBytes: 1, mimeType: "image/jpeg", width: 1920, height: 1080,
      capturedAt: new Date(), deviceId: createUuidV7(), idempotencyKey: id, requestHash: "b".repeat(64), masterVersion: 1,
      masterStorageKey: "master/" + id + "/1.jpg", masterSha256: "c".repeat(64), tier1QualityJson: { passed: true },
      createdBy: f.actor.userId, verifiedBy: f.actor.userId, verifiedAt: new Date() });
  }
  const input = { sourceSkuId: f.source.id, reason: "Observed different wheel variants", targets: [
    { skuId: f.target.id, claims: { wheel_type: "RUBBER" }, imageId: photos[0] }, { claims: { wheel_type: "IRON" }, imageId: photos[1] }
  ] };
  await expect(db.transaction(async (tx) => { await splitSku(tx, f.actor, input); throw new Error("Rollback split fixture"); })).rejects.toThrow("Rollback split fixture");
  expect((await getPriceHistory(db, f.actor, f.source.id)).map((row) => row.price.kind)).toEqual(["SET", "SET"]);
  const result = await splitSku(db, f.actor, input);
  await assertWithdrawals(f.source.id, "SKU split");
  expect(await getCurrentPrice(db, f.target.id, f.stores[0]!.id)).toMatchObject({ basePriceMinor: 40000 });
  expect(await getCurrentPrice(db, f.target.id, f.stores[1]!.id)).toBeNull();
  const createdId = result.targetSkuIds.find((id) => id !== f.target.id)!;
  for (const store of f.stores) expect(await getCurrentPrice(db, createdId, store.id)).toBeNull();
});

it("rejects an edit waiting on a SKU that becomes archived before the write can proceed", async () => {
  const f = await fixture();
  let pending: Promise<unknown> | undefined;
  await db.transaction(async (tx) => {
    await tx.select({ id: skus.id }).from(skus).where(eq(skus.id, f.source.id)).for("update");
    pending = setPrice(db, f.actor, { skuId: f.source.id, storefrontId: f.stores[0]!.id, basePriceMinor: 11000 })
      .then(() => ({ succeeded: true }), (error: unknown) => ({ error }));
    await transitionSkuLifecycle(tx, f.actor, f.source.id, "ARCHIVED", { reason: "Concurrent archive fixture" });
  });
  expect(await pending).toMatchObject({ error: { code: "PRECONDITION_FAILED" } });
  expect((await getPriceHistory(db, f.actor, f.source.id)).map((row) => row.price.kind)).toEqual(["SET", "SET"]);
});

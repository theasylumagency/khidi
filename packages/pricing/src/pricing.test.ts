import { and, eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { auditLogs, createMigratorPool, getDb, legalEntities, outboxDeliveries, outboxEvents, storefrontPrices, userPermissions, users } from "@khidi/db";
import { executeIdempotent } from "@khidi/domain";
import { createSkuDraft } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { commitPriceChanges, copyPricePreview, getCurrentPrice, getLatestPriceRow, getPriceHistory, previewPriceChanges, setPrice, withdrawPrice, type PriceChange } from "./index.ts";

const db = getDb();
async function fixture() {
  const admin = (await db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "ADMIN") }))!;
  const store = (await db.query.storefronts.findFirst())!;
  const actor = { userId: admin.id };
  const sku = await createSkuDraft(db, actor, {});
  return { actor, store, sku, change: { skuId: sku.id, storefrontId: store.id, basePriceMinor: 10000 } };
}

it("appends immediate prices and reasoned withdrawals, inherits seller VAT and preserves history", async () => {
  const f = await fixture();
  const seller = (await db.select().from(legalEntities).where(eq(legalEntities.id, f.store.sellerEntityId)))[0]!;
  const first = (await setPrice(db, f.actor, f.change)).rows[0]!;
  expect(first).toMatchObject({ currency: "GEL", vatIncluded: seller.pricesIncludeVat, setBy: f.actor.userId, source: "MANUAL" });
  await setPrice(db, f.actor, { ...f.change, basePriceMinor: 11000, vatIncluded: !seller.pricesIncludeVat });
  expect(await getCurrentPrice(db, f.sku.id, f.store.id)).toMatchObject({ basePriceMinor: 11000, vatIncluded: !seller.pricesIncludeVat });
  await expect(withdrawPrice(db, f.actor, f.change, " ")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await withdrawPrice(db, f.actor, f.change, "No base price until reviewed");
  expect(await getCurrentPrice(db, f.sku.id, f.store.id)).toBeNull();
  expect(await getLatestPriceRow(db, f.sku.id, f.store.id)).toMatchObject({ kind: "WITHDRAWN", basePriceMinor: null });
  expect((await getPriceHistory(db, f.actor, f.sku.id, f.store.id)).map((row) => row.price.kind)).toEqual(["WITHDRAWN", "SET", "SET"]);
  await setPrice(db, f.actor, { ...f.change, basePriceMinor: 100000 }); // First price after withdrawal has no current comparison.
  expect(await getCurrentPrice(db, f.sku.id, f.store.id)).toMatchObject({ basePriceMinor: 100000 });
});

it("enforces append-only privileges and trigger, positive GEL integers and no future prices", async () => {
  const f = await fixture();
  const first = (await setPrice(db, f.actor, f.change)).rows[0]!;
  await expect(db.update(storefrontPrices).set({ basePriceMinor: 1 }).where(eq(storefrontPrices.id, first.id))).rejects.toThrow();
  await expect(db.delete(storefrontPrices).where(eq(storefrontPrices.id, first.id))).rejects.toThrow();
  const pool = createMigratorPool();
  try {
    await expect(pool.query("UPDATE storefront_prices SET reason='changed' WHERE id=$1", [first.id])).rejects.toThrow(/append.only/i);
  } finally { await pool.end(); }
  for (const invalid of [{ basePriceMinor: 0 }, { basePriceMinor: -1 }, { basePriceMinor: 1.1 }, { currency: "USD" }, { validFrom: new Date() }]) {
    await expect(setPrice(db, f.actor, { ...f.change, ...invalid } as PriceChange)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  }
  for (const invalid of [{ basePriceMinor: 0 }, { basePriceMinor: -1 }, { basePriceMinor: 1.1 }, { currency: "USD" }, { setAt: new Date(Date.now() + 86400000) }]) {
    await expect(db.insert(storefrontPrices).values({ ...first, ...invalid, id: createUuidV7() })).rejects.toThrow();
  }
});

it("requires confirmation and reason at the 30% boundary in either direction; threshold is configurable", async () => {
  const f = await fixture();
  await setPrice(db, f.actor, f.change);
  const change = { ...f.change, basePriceMinor: 13000 };
  expect((await previewPriceChanges(db, f.actor, { changes: [change] }))[0]).toMatchObject({ largeChange: true, deltaMinor: 3000, differenceRatio: 0.3 });
  for (const options of [{}, { reason: "Adjusted" }, { confirmLargeChanges: true }]) {
    await expect(setPrice(db, f.actor, change, options)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  }
  await setPrice(db, f.actor, change, { reason: "Confirmed factory increase", confirmLargeChanges: true });
  await expect(setPrice(db, f.actor, { ...change, basePriceMinor: 9100 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  vi.stubEnv("PRICE_LARGE_CHANGE_RATIO", "0.1");
  try { expect((await previewPriceChanges(db, f.actor, { changes: [{ ...change, basePriceMinor: 14300 }] }))[0]?.largeChange).toBe(true); }
  finally { vi.unstubAllEnvs(); }
});

it("rejects ungranted operators and warehouse users, accepts price.edit, and reserves VAT overrides for admins", async () => {
  const f = await fixture();
  const [operator, warehouse] = await db.insert(users).values(["OPERATOR", "WAREHOUSE"].map((role) => ({ id: createUuidV7(), role, fullName: "Pricing test" }))).returning();
  if (!operator || !warehouse) throw new Error("Fixture users missing");
  await expect(setPrice(db, { userId: operator.id }, f.change)).rejects.toMatchObject({ code: "FORBIDDEN" });
  for (const user of [operator, warehouse]) await db.insert(userPermissions).values({ userId: user.id, permissionKey: "price.edit", grantedBy: f.actor.userId });
  try {
    await setPrice(db, { userId: operator.id }, f.change);
    const seller = (await db.select().from(legalEntities).where(eq(legalEntities.id, f.store.sellerEntityId)))[0]!;
    await expect(setPrice(db, { userId: operator.id }, { ...f.change, vatIncluded: !seller.pricesIncludeVat })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setPrice(db, { userId: warehouse.id }, f.change)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getPriceHistory(db, { userId: warehouse.id }, f.sku.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally { for (const user of [operator, warehouse]) await db.delete(userPermissions).where(and(eq(userPermissions.userId, user.id), eq(userPermissions.permissionKey, "price.edit"))); }
});

it("commits batches atomically and replays once with one audit, outbox event and storefront delivery per row", async () => {
  const f = await fixture();
  const other = await createSkuDraft(db, f.actor, {});
  const changes = [f.change, { ...f.change, skuId: other.id }];
  await expect(commitPriceChanges(db, f.actor, { source: "BULK", changes: [f.change, { ...f.change, skuId: createUuidV7() }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await getCurrentPrice(db, f.sku.id, f.store.id)).toBeNull();
  const key = createUuidV7();
  const commit = () => executeIdempotent(db, { scope: "pricing-test", idempotencyKey: key, payload: changes }, async (tx) => ({
    status: 201, body: await commitPriceChanges(tx, f.actor, { changes, source: "BULK" })
  }));
  const result = await commit();
  expect((await commit()).body).toEqual(JSON.parse(JSON.stringify(result.body)));
  expect(result.body.batchId).toBeTruthy();
  for (const row of result.body.rows) {
    expect(row.batchId).toBe(result.body.batchId);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, row.id))).toHaveLength(1);
    const events = await db.select().from(outboxEvents).where(sql`${outboxEvents.payloadJson}->>'priceId' = ${row.id}`);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "PRICE_CHANGED", payloadJson: { batchId: result.body.batchId } });
    expect(await db.select().from(outboxDeliveries).where(eq(outboxDeliveries.outboxEventId, events[0]!.id)))
      .toMatchObject([{ consumer: "storefront:" + f.store.id }]);
  }
});

it("rejects stale previews and serializes concurrent first prices", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([10000, 11000].map((basePriceMinor) => setPrice(db, f.actor, { ...f.change, basePriceMinor, expectedPriceId: null })));
  expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((row) => row.status === "rejected")).toHaveLength(1);
  const before = await getCurrentPrice(db, f.sku.id, f.store.id);
  await expect(setPrice(db, f.actor, { ...f.change, expectedPriceId: null })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await getCurrentPrice(db, f.sku.id, f.store.id)).toEqual(before);
});

it("preserves an admin's VAT exception across omitted/explicit operator VAT and rejects changes", async () => {
  const f = await fixture();
  const [operator] = await db.insert(users).values({ id: createUuidV7(), role: "OPERATOR", fullName: "VAT exception fixture" }).returning();
  await db.insert(userPermissions).values({ userId: operator!.id, permissionKey: "price.edit", grantedBy: f.actor.userId });
  const actor = { userId: operator!.id };
  await setPrice(db, f.actor, { ...f.change, vatIncluded: false });
  expect((await setPrice(db, actor, { ...f.change, basePriceMinor: 10500 })).rows[0]?.vatIncluded).toBe(false);
  expect((await setPrice(db, actor, { ...f.change, basePriceMinor: 11000, vatIncluded: false })).rows[0]?.vatIncluded).toBe(false);
  await expect(setPrice(db, actor, { ...f.change, basePriceMinor: 11500, vatIncluded: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await withdrawPrice(db, actor, f.change, "Temporary withdrawal");
  expect((await setPrice(db, actor, { ...f.change, basePriceMinor: 11000 })).rows[0]?.vatIncluded).toBe(false);
});

it("copies selected base amounts through a large-change preview and uses the destination seller VAT default", async () => {
  const f = await fixture();
  const target = (await db.query.storefronts.findMany()).find((row) => row.id !== f.store.id)!;
  await setPrice(db, f.actor, f.change);
  await setPrice(db, f.actor, { ...f.change, storefrontId: target.id, basePriceMinor: 1000 });
  const preview = await copyPricePreview(db, f.actor, f.store.id, target.id, [f.sku.id]);
  expect(preview[0]).toMatchObject({ basePriceMinor: 10000, largeChange: true, unchanged: false });
  expect(await getCurrentPrice(db, f.sku.id, target.id)).toMatchObject({ basePriceMinor: 1000 });
  const changes = preview.map(({ skuId, storefrontId, basePriceMinor, expectedPriceId }) => ({ skuId, storefrontId, basePriceMinor, expectedPriceId }));
  await expect(commitPriceChanges(db, f.actor, { source: "BULK", changes })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const result = await commitPriceChanges(db, f.actor, { source: "BULK", changes, reason: "Copy approved base prices", confirmLargeChanges: true });
  const seller = (await db.query.legalEntities.findMany()).find((row) => row.id === target.sellerEntityId)!;
  expect(result.rows[0]).toMatchObject({ source: "BULK", vatIncluded: seller.pricesIncludeVat });
  expect(result.batchId).toBeTruthy();
  await expect(copyPricePreview(db, f.actor, f.store.id, target.id, [createUuidV7()])).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

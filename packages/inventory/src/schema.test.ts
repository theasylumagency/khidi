import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { allocationBalances, allocations, createMigratorPool, getDb, poolLocations, poolSkuBalances, stockPools } from "@khidi/db";
import { createSkuDraft } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";

it("enforces C2 generated quantities, per-row checks, sum consistency and stable inventory identities", async () => {
  const db = getDb();
  const admin = (await db.query.users.findFirst({ where: (t, { eq }) => eq(t.role, "ADMIN") }))!;
  const store = (await db.query.storefronts.findFirst())!;
  const sku = await createSkuDraft(db, { userId: admin.id }, {});
  const [pool] = await db.insert(stockPools).values({ id: createUuidV7(), ownerEntityId: store.sellerEntityId, name: "Schema test" }).returning();
  const poolId = pool!.id;
  await db.insert(poolLocations).values(["SHELF", "STAGING"].map((kind) => ({ id: createUuidV7(), poolId, kind: kind as "SHELF" | "STAGING", name: kind })));
  const [a] = await db.insert(allocations).values({ id: createUuidV7(), poolId, skuId: sku.id, storefrontId: store.id }).returning();
  await db.transaction(async (tx) => {
    await tx.insert(poolSkuBalances).values({ poolId, skuId: sku.id, shelf: 7, staging: 1, allocatedTotal: 5 });
    await tx.insert(allocationBalances).values({ allocationId: a!.id, allocated: 5, reserved: 2, committed: 1 });
  });
  expect(await db.query.poolSkuBalances.findFirst({ where: (t, { eq }) => eq(t.poolId, poolId) })).toMatchObject({ unallocated: 3 });
  expect(await db.query.allocationBalances.findFirst({ where: (t, { eq }) => eq(t.allocationId, a!.id) })).toMatchObject({ availableToSell: 2 });
  for (const invalid of [{ shelf: -1 }, { staging: -1 }, { allocatedTotal: -1 }, { allocatedTotal: 9 }, { staging: 6 }]) {
    await expect(db.update(poolSkuBalances).set(invalid).where(eq(poolSkuBalances.poolId, poolId))).rejects.toThrow();
  }
  for (const invalid of [{ reserved: -1 }, { committed: -1 }, { allocated: -1 }, { reserved: 5 }, { allocated: 4 }]) {
    await expect(db.update(allocationBalances).set(invalid).where(eq(allocationBalances.allocationId, a!.id))).rejects.toThrow();
  }
  await expect(db.update(allocations).set({ skuId: createUuidV7() }).where(eq(allocations.id, a!.id))).rejects.toThrow();
  await expect(db.delete(stockPools).where(eq(stockPools.id, poolId))).rejects.toThrow();
  const migrator = createMigratorPool();
  try {
    const checks = await migrator.query("SELECT has_table_privilege('hub_app','stock_ledger','UPDATE') AS u, has_table_privilege('hub_app','stock_ledger','DELETE') AS d");
    expect(checks.rows[0]).toEqual({ u: false, d: false });
    await expect(db.execute(sql`UPDATE pool_sku_balances SET unallocated=0 WHERE pool_id=${poolId}`)).rejects.toThrow();
  } finally { await migrator.end(); }
});

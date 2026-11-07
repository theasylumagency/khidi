import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { allocationBalances, connectMigratorDatabase, poolSkuBalances } from "@khidi/db";
import { rebuildBalancesFromLedger, verifyInventoryBalances } from "./rebuild.ts";
import { inventoryFixture } from "./test-fixture.ts";

it("rebuilds all six deltas and verifies quantities without touching balances or history",async()=>{
  const f=await inventoryFixture();
  await f.apply([{...f.line,type:"RESERVE",quantity:6,paymentMethod:"CARD"},{...f.line,type:"COMMIT",quantity:4},
    {...f.line,type:"PICK_TO_STAGING",quantity:3},{...f.line,type:"HANDOVER_OUT",quantity:2}]);
  const before=await f.db.select().from(poolSkuBalances).where(eq(poolSkuBalances.poolId,f.base.poolId));
  expect(await rebuildBalancesFromLedger(f.db,f.sku.id)).toMatchObject({pools:[{shelf:97,staging:1,allocatedTotal:58,unallocated:40}],allocations:[{allocated:58,reserved:2,committed:2,availableToSell:54}]});
  expect(await verifyInventoryBalances(f.db,f.sku.id)).toMatchObject({ok:true,differences:[]});
  expect(await f.db.select().from(poolSkuBalances).where(eq(poolSkuBalances.poolId,f.base.poolId))).toEqual(before);
  // Deliberate materialization drift in a rolled-back transaction: verify reports and never repairs it.
  await expect(f.db.transaction(async(tx)=>{
    await tx.update(poolSkuBalances).set({shelf:98}).where(eq(poolSkuBalances.poolId,f.base.poolId));
    const result=await verifyInventoryBalances(tx,f.sku.id);
    expect(result).toMatchObject({ok:false,differences:[{kind:"pool",field:"shelf",expected:97,actual:98},{kind:"pool",field:"unallocated",expected:40,actual:41}]});
    expect((await tx.select().from(poolSkuBalances).where(eq(poolSkuBalances.poolId,f.base.poolId)))[0]!.shelf).toBe(98);
    throw new Error("Rollback drift fixture");
  })).rejects.toThrow("Rollback drift fixture");
  expect(await verifyInventoryBalances(f.db,f.sku.id)).toMatchObject({ok:true});
});

it("reports missing materializations, including a zero result with ledger history",async()=>{
  const f=await inventoryFixture();
  const owner=connectMigratorDatabase();
  try {
    await expect(owner.db.transaction(async(tx)=>{
      await tx.delete(allocationBalances).where(eq(allocationBalances.allocationId,f.line.allocationId));
      await tx.delete(poolSkuBalances).where(eq(poolSkuBalances.poolId,f.base.poolId));
      const result=await verifyInventoryBalances(tx,f.sku.id);
      expect(result.ok).toBe(false);
      expect(result.differences).toEqual(expect.arrayContaining([
        {kind:"pool",key:f.base.poolId+":"+f.sku.id,field:"shelf",expected:100,actual:null},
        {kind:"allocation",key:f.line.allocationId,field:"reserved",expected:0,actual:null}
      ]));
      throw new Error("Rollback missing fixture");
    })).rejects.toThrow("Rollback missing fixture");
  } finally {await owner.close();}
  expect(await verifyInventoryBalances(f.db,f.sku.id)).toMatchObject({ok:true});
});

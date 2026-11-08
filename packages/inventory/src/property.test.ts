import { randomInt } from "node:crypto";
import { expect, it } from "vitest";
import fc from "fast-check";
import { asc, eq, inArray } from "drizzle-orm";
import { allocationBalances, allocations, getDb, legalEntities, poolLocations, poolSkuBalances, stockLedger, stockPools, storefronts, type DbExecutor } from "@khidi/db";
import { setEntityRelationship } from "@khidi/entities";
import { createSkuDraft } from "@khidi/products";
import { AppError, createUuidV7 } from "@khidi/shared";
import { configureAvailabilityPool } from "./advanced.ts";
import { setOnlineAvailability } from "./availability.ts";
import { applyStockMovements, type StockWorkflowProofs } from "./engine.ts";
import { primitiveWorkflowFixture } from "./primitive-workflow.test-fixture.ts";
import { rebuildBalancesFromLedger } from "./rebuild.ts";
import { capacity, isCod, lineIndex, modelAvailability, modelBatch, operations, totals, type Command, type Outcome, type StockModel } from "./property-model.test-fixture.ts";
import type { StockMovement } from "./types.ts";

function integerSetting(name: string, fallback: number, minimum: number, maximum: number) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer in [${minimum}, ${maximum}].`);
  return value;
}
const numRuns = integerSetting("INVENTORY_PROPERTY_RUNS", 25, 1, 100_000);
const seed = integerSetting("INVENTORY_PROPERTY_SEED", randomInt(-2_147_483_648, 2_147_483_647), -2_147_483_648, 2_147_483_647);

const descriptor = fc.record({ op: fc.constantFrom(...operations), store: fc.integer({ min: 0, max: 1 }), line: fc.integer({ min: 0, max: 3 }),
  request: fc.constant(0), quantity: fc.integer({ min: 1, max: 8 }), malformed: fc.integer({ min: 0, max: 4 }).map((n) => n === 0),
  boundary: fc.constantFrom("raw", "limit", "limit", "limit", "over", "zero", "negative") });
const replenishAndReserve = fc.record({ store: fc.integer({ min: 0, max: 1 }), line: fc.integer({ min: 0, max: 3 }), quantity: fc.integer({ min: 1, max: 4 }) })
  .map((c) => ({ kind: "batch" as const, commands: (["in", "allocate", "reserve"] as const)
    .map((op) => ({ ...c, op, request: 0, malformed: false, boundary: "raw" })) }));
const step = fc.oneof(
  fc.record({ kind: fc.constant("batch" as const), commands: fc.array(descriptor, { minLength: 1, maxLength: 3 }) }),
  replenishAndReserve,
  fc.record({ kind: fc.constant("availability" as const), store: fc.integer({ min: 0, max: 1 }), target: fc.integer({ min: -2, max: 20 }) })
);
const scenario = fc.record({ firstStore: fc.integer({ min: 0, max: 1 }), transfer: fc.integer({ min: 1, max: 3 }),
  firstTarget: fc.integer({ min: 1, max: 8 }), secondTarget: fc.integer({ min: 0, max: 8 }), steps: fc.array(step, { minLength: 8, maxLength: 18 }) });

async function fixture() {
  const db = getDb(), admin = (await db.query.users.findFirst({ where: (u, { eq }) => eq(u.role, "ADMIN") }))!;
  const actor = { userId: admin.id }, sku = await createSkuDraft(db, actor, {});
  const entities = await db.insert(legalEntities).values([0, 1].map(() => ({ id: createUuidV7(), key: "property-" + createUuidV7(), legalName: "Property fixture", taxId: createUuidV7(), pricesIncludeVat: true }))).returning();
  const stores = await db.insert(storefronts).values(entities.map((e) => ({ id: createUuidV7(), key: "property-" + createUuidV7(), name: "Property fixture", domain: createUuidV7() + ".example.test", sellerEntityId: e.id, mediaBaseUrl: "https://media.example.test" }))).returning();
  const [pool] = await db.insert(stockPools).values({ id: createUuidV7(), ownerEntityId: entities[0]!.id, name: "Model property fixture" }).returning();
  await db.insert(poolLocations).values((["SHELF", "STAGING"] as const).map((kind) => ({ id: createUuidV7(), poolId: pool!.id, kind, name: kind })));
  await setEntityRelationship(db, actor, { fromEntityId: entities[0]!.id, toEntityId: entities[1]!.id, mode: "CONSIGNMENT" });
  const assigned = await db.insert(allocations).values(stores.map((s) => ({ id: createUuidV7(), poolId: pool!.id, skuId: sku.id, storefrontId: s.id }))).returning();
  for (const s of stores) await configureAvailabilityPool(db, actor, { storefrontId: s.id, poolId: pool!.id });
  return { db, actor, sku, stores, assigned, owner: entities[0]!.id, poolId: pool!.id,
    lines: Array.from({ length: 8 }, () => createUuidV7()), requests: Array.from({ length: 16 }, () => createUuidV7()), countId: createUuidV7() };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Transport adapter only; no validity decision or model update is taken from engine output. */
function movements(f: Fixture, c: Command): StockMovement[] {
  const base = { poolId: f.poolId, skuId: f.sku.id, quantity: c.quantity };
  const allocated = { ...base, allocationId: f.assigned[c.store]!.id };
  const line = { ...allocated, reservationId: f.lines[lineIndex(c)]!, fulfillmentRequestId: f.requests[lineIndex(c) * 2 + c.request]! };
  const reason = c.malformed ? undefined : "Model property operation";
  const transferKey = createUuidV7();
  switch (c.op) {
    case "in": return [{ ...base, type: "STOCK_IN" }];
    case "out": return [{ ...base, type: "STOCK_OUT", reason }];
    case "writeOff": return [{ ...base, type: "WRITE_OFF", reason }];
    case "allocate": return [{ ...allocated, type: "ALLOCATE" }];
    case "deallocate": return [{ ...allocated, type: "DEALLOCATE" }];
    case "reserve": return [{ ...line, type: "RESERVE", paymentMethod: isCod(c.line) !== !!c.malformed ? "CASH_ON_DELIVERY" : "CARD" }];
    case "release": return [{ ...line, type: "RESERVATION_RELEASE" }];
    case "commit": return [{ ...line, type: "COMMIT" }];
    case "releaseCommit": return [{ ...line, type: "COMMIT_RELEASE" }];
    case "pick": return [{ ...line, type: "PICK_TO_STAGING" }];
    case "return": return [{ ...line, type: "RETURN_TO_SHELF", scanConfirmed: !c.malformed }];
    case "handover": return isCod(c.line) ? [{ ...line, type: "COMMIT" }, ...c.malformed ? [] : [{ ...line, type: "HANDOVER_OUT" as const }]] : [{ ...line, type: "HANDOVER_OUT" }];
    case "lostReserved": case "lostCommitted": return [{ ...line, type: "ADJUSTMENT", variant: c.op === "lostReserved" ? "STAGING_RESERVED" : "STAGING_COMMITTED", reason, cancelLostLine: !c.malformed }];
    case "transfer": return [{ ...allocated, type: "TRANSFER_OUT", variant: "SAME_POOL", transferKey },
      { ...base, allocationId: f.assigned[c.malformed ? c.store : 1 - c.store]!.id, type: "TRANSFER_IN", variant: "SAME_POOL", transferKey }];
    case "increase": case "decrease": return [{ ...base, type: "ADJUSTMENT", variant: c.op === "increase" ? "SHELF_INCREASE" : "SHELF_DECREASE", reason, approvedCountLineId: c.malformed ? undefined : f.countId }];
  }
}

async function snapshot(tx: DbExecutor, f: Fixture) {
  const [pool, balances, ledger] = await Promise.all([
    tx.select().from(poolSkuBalances).where(eq(poolSkuBalances.poolId, f.poolId)),
    tx.select().from(allocationBalances).where(inArray(allocationBalances.allocationId, f.assigned.map((a) => a.id))),
    tx.select().from(stockLedger).where(eq(stockLedger.skuId, f.sku.id)).orderBy(asc(stockLedger.id))
  ]);
  return { pool, balances: f.assigned.map((a) => balances.find((b) => b.allocationId === a.id)!), ledger };
}
function assertState(actual: Awaited<ReturnType<typeof snapshot>>, model: StockModel, f: Fixture) {
  const expected = totals(model);
  expect(actual.pool).toHaveLength(1);
  expect(actual.pool[0]).toMatchObject(expected.pool);
  expected.allocations.forEach((a, i) => expect(actual.balances[i]).toMatchObject(a));
  const { shelf, staging, allocatedTotal, unallocated } = expected.pool;
  expect([shelf, staging, unallocated].every((n) => n >= 0)).toBe(true);
  expect(allocatedTotal).toBe(expected.allocations.reduce((n, a) => n + a.allocated, 0));
  expect(staging).toBeLessThanOrEqual(allocatedTotal);
  expect(allocatedTotal).toBeLessThanOrEqual(shelf + staging);
  for (let i = 0; i < 8; i++) {
    const units = model.units.filter((u) => u.line === i), rows = actual.ledger.filter((r) => r.reservationId === f.lines[i]);
    expect(rows.reduce((n, r) => n + r.reservedDelta, 0)).toBe(units.filter((u) => !u.committed).length);
    expect(rows.reduce((n, r) => n + r.committedDelta, 0)).toBe(units.filter((u) => u.committed).length);
    for (let request = 0; request < 2; request++) {
      expect(rows.filter((r) => r.fulfillmentRequestId === f.requests[i * 2 + request]).reduce((n, r) => n + r.stagingDelta, 0))
        .toBe(units.filter((u) => u.request === request).length);
    }
  }
  expect(actual.ledger.every((r) => r.ownerEntityId === f.owner)).toBe(true);
  expect(actual.ledger.filter((r) => r.allocationId === f.assigned[1]!.id)
    .every((r) => r.crossEntity && r.relationshipMode === "CONSIGNMENT" && r.storefrontId === f.stores[1]!.id)).toBe(true);
}

it("matches an independent unit model for valid/invalid shared-pool batches and absolute availability", async () => {
  console.info(`[inventory property] runs=${numRuns} seed=${seed} (replay with INVENTORY_PROPERTY_SEED)`);
  const f = await fixture(), coverage = new Map<string, number>(), proofCalls = { count: 0, scan: 0, lost: 0 };
  let completed = 0;
  const proofs: StockWorkflowProofs = {
    assertApprovedCountLine: async (_ctx, m) => { expect(m.approvedCountLineId).toBe(f.countId); proofCalls.count++; },
    assertScanConfirmedReturn: async (_ctx, m) => { expect(m.scanConfirmed).toBe(true); proofCalls.scan++; },
    cancelLostFulfillmentLine: async (_ctx, m) => { expect(m.cancelLostLine).toBe(true); proofCalls.lost++; }
  };
  const command = (op: Command["op"], store: number, line = 0, quantity = 1, request = 0): Command => ({ op, store, line, quantity, request });
  const initial: Command[] = [command("in", 0, 0, 36), command("allocate", 0, 0, 12), command("allocate", 1, 0, 12)];
  for (const store of [0, 1]) for (let line = 0; line < 4; line++) {
    initial.push(command("reserve", store, line, 2));
    if (!isCod(line)) initial.push(command("commit", store, line));
    initial.push(command("pick", store, line));
  }
  const initialModel = modelBatch({ units: [] }, initial);
  expect(initialModel.outcome).toBe("APPLIED");
  await f.db.transaction(async(tx)=>applyStockMovements(tx,f.actor,await primitiveWorkflowFixture(tx,f.actor.userId,initial.flatMap((c)=>movements(f,c))),proofs));

  await fc.assert(fc.asyncProperty(scenario, async (program) => {
    // Each generated program starts from the same rich state; rollback also resets shrinking/replay.
    const rollback = new Error("Rollback generated scenario");
    try {
      await f.db.transaction(async (tx) => {
        let model = structuredClone(initialModel.model), before = await snapshot(tx, f), stepIndex = 0;
        assertState(before, model, f);
        async function run(commands: Command[] | { store: number; target: number }) {
          const predicted = Array.isArray(commands) ? modelBatch(model, commands) : modelAvailability(model, commands.store, commands.target);
          let actual: Outcome;
          try {
            if (Array.isArray(commands)) actual = (await tx.transaction(async(inner)=>applyStockMovements(inner,f.actor,await primitiveWorkflowFixture(inner,f.actor.userId,commands.flatMap((c)=>movements(f,c))),proofs))).status;
            else { await setOnlineAvailability(tx, f.actor, { skuId: f.sku.id, storefrontId: f.stores[commands.store]!.id, target: commands.target, idempotencyKey: createUuidV7() }); actual = "APPLIED"; }
          } catch (error) {
            // A DB error is a failure, not evidence of a correct domain rejection.
            if (!(error instanceof AppError) || !["PRECONDITION_FAILED", "VALIDATION_ERROR"].includes(error.code)) throw error;
            actual = "REJECTED";
          }
          const label = `step ${stepIndex++}: ${JSON.stringify(commands)}`;
          expect(actual, label).toBe(predicted.outcome);
          const after = await snapshot(tx, f);
          if (actual !== "APPLIED") expect(after, `${label}: failed batch changed balances or ledger`).toEqual(before);
          model = predicted.model;
          assertState(after, model, f);
          for (const kind of Array.isArray(commands) ? commands.map((c) => c.op) : ["availability:" + commands.store]) {
            const key = kind + ":" + actual; coverage.set(key, (coverage.get(key) ?? 0) + 1);
          }
          before = after;
        }
        const a = program.firstStore, b = 1 - a;
        // Randomized feature sweep ensures rare workflows are exercised even at the moderate default.
        await run([command("handover", a, 0), command("handover", a, 1),
          command("lostCommitted", a, 2), command("lostReserved", a, 3), command("return", b, 0),
          command("pick", b, 0), command("return", b, 0), command("transfer", a, 0, program.transfer)]);
        // Two admins' targets interleaved with another storefront's reservation on the shared pool.
        await run({ store: a, target: program.firstTarget });
        await run([command("reserve", b, 0), command("reserve", a, 0)]);
        await run({ store: b, target: program.secondTarget });
        await run({ store: a, target: program.firstTarget + 1 });
        const loose = totals(model).pool.unallocated;
        await run([command("decrease", a, 0, loose + 1)]);
        await run([command("deallocate", a), command("decrease", a, 0, loose + 1)]);
        const heldShortfall = model.units.filter((u) => u.line === null).length + 1;
        await run([command("decrease", a, 0, heldShortfall)]);
        await run([command("in", a), command("reserve", b, 0, 10_000)]);
        await run([{ ...command("transfer", a), malformed: true }]);

        for (const generated of program.steps) {
          if (generated.kind === "availability") await run(generated);
          else {
            let planned = model;
            const commands = generated.commands.map((d): Command => {
              const limit = capacity(planned, d);
              const quantity = d.boundary === "limit" ? Math.max(1, limit) : d.boundary === "over" ? limit + 1 : d.boundary === "zero" ? 0 : d.boundary === "negative" ? -d.quantity : d.quantity;
              const c = { ...d, quantity };
              const next = modelBatch(planned, [c]); if (next.outcome === "APPLIED") planned = next.model;
              return c;
            });
            await run(commands);
          }
        }
        const rebuilt = await rebuildBalancesFromLedger(tx, f.sku.id), expected = totals(model);
        expect(rebuilt.pools).toEqual([{ poolId: f.poolId, skuId: f.sku.id, ...expected.pool }]);
        expect(rebuilt.allocations).toEqual(expected.allocations.map((v, i) => ({ allocationId: f.assigned[i]!.id, ...v })).sort((x, y) => x.allocationId.localeCompare(y.allocationId)));
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    if (++completed % 25 === 0) console.info(`[inventory property] completed=${completed}/${numRuns} seed=${seed}`);
  }), { numRuns, seed, verbose: true });
  for (const op of ["handover", "lostReserved", "lostCommitted", "pick", "return", "transfer", "availability:0", "availability:1"]) {
    expect(coverage.get(op + ":APPLIED"), op + " coverage").toBeGreaterThan(0);
  }
  for (const result of ["APPLIED", "REQUIRES_DEALLOCATION", "CRITICAL"]) expect(coverage.get("decrease:" + result)).toBeGreaterThan(0);
  expect(coverage.get("reserve:REJECTED")).toBeGreaterThan(0);
  expect(Object.values(proofCalls).every((n) => n > 0)).toBe(true);
  console.info(`[inventory property] passed runs=${numRuns} seed=${seed} outcomes=${JSON.stringify(Object.fromEntries([...coverage].sort()))}`);
}, Math.max(60_000, numRuns * 3_000));

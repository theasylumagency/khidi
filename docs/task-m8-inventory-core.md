# Khidi — Milestone 8: Inventory Core

Repository: `theasylumagency/khidi`

This is the most critical milestone: errors here oversell products or lose stock. It is built in
**two phases with a human review in between**. One commit per step. Never commit to `main`.

- **Phase 1** (branch `m8-inventory-core`): schema, ledger engine, invariants, locking. Open a
  **Draft PR** and **stop**. Do not start Phase 2 until the owner approves Phase 1.
- **Phase 2** (same branch after approval): manual stock operations, counts, replenishment,
  sellability, UI.

## 1. Read first

- `AGENTS.md`
- Specification v1.2 §4 (entities, storefronts, ownership), §10 (inventory), §13 (roles),
  §15.2 (sellability)
- `docs/AgroTrade Hub — Corrections to Implementation Plan v1.1.md` — **C1, C2, C3 (the complete
  15-type invariant matrix with Rule A and Rule B), C4, C7, C13, C14, C17**. C2 and C3 are the
  specification of the ledger; implement them exactly.
- Implementation Plan v1.1, Milestone 8
- ADR-011 Part B (split with inventory stays Proposed)
- `docs/milestones/m7-pricing.md`

### Existing components — extend, do not rebuild

- `legal_entities` (`prices_include_vat`), `storefronts` (`seller_entity_id`, immutable `key`),
  `entity_relationships` (`PURCHASE` / `CONSIGNMENT`, `effective_from`) — migration 0001.
- `PHYSICAL_COUNT` task type exists in the scanning schema but is disabled with "available from
  milestone 8" (`packages/scanning/src/tasks.ts`).
- `packages/publishing` reports `ALLOCATION_OWNERS_UNAVAILABLE_M8`.
- STOCK_MANAGER role limited to its own legal entity (auth tests already cover this).
- `packages/domain/src/price-effects.ts` (price withdrawal during SKU corrections).
- ADR-011: the split service must refuse SKUs with inventory records.

Before writing code, add a short gap inventory to `docs/milestones/m8-inventory-core.md`.

## 2. Decisions already made

1. **Operating model (spec §10.1).** AgroTrade gives the Hub no access to accounting. Units for
   online sale are moved, in AgroTrade's own accounting, to a dedicated online warehouse and kept
   on a physically marked online shelf; an authorized user enters the same quantities into the
   Hub manually. The Hub never reads or writes accounting data.
2. **Quantities are integer pieces.** Products sold by length, weight or volume are out of scope
   for the online channel in Phase 1; record any such need as an open question, do not model it.
3. **Returns after handover are outside the Hub (C1).** No `RETURN_RESTOCK` or `MANUAL_RESTORE`.
   A returned unit re-enters only through `STOCK_IN`.
4. **Exactly 15 movement types (C3 + C14).** `STOCK_IN`, `STOCK_OUT`, `WRITE_OFF`, `ADJUSTMENT`,
   `PICK_TO_STAGING`, `RETURN_TO_SHELF`, `HANDOVER_OUT`, `ALLOCATE`, `DEALLOCATE`,
   `TRANSFER_OUT`, `TRANSFER_IN`, `RESERVE`, `RESERVATION_RELEASE`, `COMMIT`, `COMMIT_RELEASE`.
   `ADJUSTMENT` has the shelf ± and the staging − (C14, admin only) variants. M8 implements all
   15 as ledger primitives with tests; the reservation and fulfillment **engines** that call the
   commitment and picking primitives are M9.
5. **Relationship mode default.** With no active `entity_relationships` row between two entities,
   a storefront may only be allocated stock from pools owned by its own seller entity.
   Cross-entity allocation requires an active `CONSIGNMENT` relationship; cross-entity pool
   transfer requires an active `PURCHASE` relationship and a document reference (Rule B).
6. **Counting never auto-increments.** The M3 scanner re-detects a code that leaves the frame for
   0.8 s; that would overcount. A count line is created by scanning or searching a SKU and then
   **typing the counted quantity** for one location; scanning the same SKU again in the same
   count opens the existing line for editing.
7. **Count timing.** Expected quantity for a count line is taken at the moment the line is
   confirmed (store `expected_at`), so movements after that line do not create false differences.
   Movements before confirmation are included.
8. **Global lock order.** Every operation that touches pricing, catalog corrections or inventory
   acquires locks in one canonical order:
   1. advisory locks (`price:*`, `identity catalog`, other keyed locks), sorted by key;
   2. `skus` row locks, sorted by id;
   3. `pool_sku_balances` rows, sorted by `(pool_id, sku_id)`;
   4. `allocation_balances` rows, sorted by `allocation_id`.
   Implement one helper used by all services and document it in
   `docs/architecture/locking.md`. Fix `withdrawArchivedSkuPrices` and the archived-SKU price
   trigger path so they follow this order (today a correction locks the SKU row before the price
   advisory lock, while a price commit takes the advisory lock first).
9. **Who may do what.** STOCK_MANAGER: stock operations and counts for pools owned by their own
   entity. ADMIN: everything, including cross-entity transfers, staging adjustments and mode
   changes. WAREHOUSE: counting tasks assigned to them only; never sees balances, prices or
   expected quantities while counting (blind count).

## 3. Phase 1 — ledger, invariants, locking (stop for review afterwards)

**I1 — Schema** (new migrations): `stock_pools` (owner entity), `pool_locations` (`SHELF`,
`STAGING` per pool), `allocations` (pool, storefront, SKU, minimum stock),
`pool_sku_balances` and `allocation_balances` exactly as C2, with all CHECK constraints and the
generated `unallocated` / `available_to_sell` columns. `stock_ledger` with the 15 types,
per-row deltas (shelf, staging, alloc_total, allocated, reserved, committed), location,
`owner_entity_id`, `seller_entity_id`, `storefront_id`, `relationship_mode`, `cross_entity`,
`document_ref`, `reason`, actor, `correlation_id`, nullable `reservation_id` /
`fulfillment_request_id`, and nullable accounting snapshot columns for `COMMIT` (C18:
`seller_accounting_item_id`, `seller_accounting_name`, `owner_accounting_item_id`,
`owner_accounting_name`). Append-only with trigger and `hub_app` privileges (C7). Allocation
validity per decision 5 enforced in the domain and, where expressible, in the database.

**I2 — Ledger engine.** One domain entry point (e.g. `applyStockMovements`) that takes a list of
movements, acquires locks per decision 8, checks every precondition from the C3 matrix, writes
ledger rows and updates balances in one transaction, with audit and outbox (`STOCK_CHANGED`).
Encode the matrix as **one data table** in code (deltas + precondition per type) that the
engine and the tests both read, so the matrix cannot drift. Rule A (negative shelf adjustment
beyond unallocated proposes DEALLOCATE; blocked with CRITICAL when reserved/committed units are
missing) and Rule B (transfers) exactly as C3. Database CHECKs remain the backstop.

**I3 — Rebuild and verification.** `rebuildBalancesFromLedger()` and an ops command
`inventory:verify` that compares materialized balances with the rebuilt ones and reports any
difference without changing data.

**I4 — Locking.** The helper and `docs/architecture/locking.md` per decision 8, the
`price-effects` fix, and the ADR-011 split refusal for SKUs with inventory records.

**Phase 1 tests**

- each of the 15 types: deltas match the matrix table; every precondition rejects when violated;
- concurrent `STOCK_OUT` and `ALLOCATE` on the last unallocated unit: exactly one succeeds;
- concurrent `RESERVE` primitives on the last available unit: exactly one succeeds;
- property-based test (add `fast-check`, exact version at least two weeks old): random valid
  operation sequences never break invariants 1–6 of C2, and rebuilt balances equal materialized
  balances; keep the default run count moderate so the suite stays fast;
- Rule A cases; Rule B for same pool, CONSIGNMENT allocation, PURCHASE pool transfer with and
  without document reference, and no-relationship rejection;
- `stock_ledger` UPDATE/DELETE fails at DB level;
- a merge/split correction and a price commit on the same SKU run concurrently without deadlock;
- split refused for a SKU with any inventory record.

**End of Phase 1:** focused tests while working; at the end once: typecheck, lint, boundaries,
build, full suite on a fresh `_test` database. Update `docs/milestones/m8-inventory-core.md`,
open a **Draft PR**, report, and **stop**.

## 4. Phase 2 — operations, counts, replenishment, sellability (after approval)

**I5 — Manual stock operations** (services + desktop UI, Georgian): receive into pool
(`STOCK_IN`, optional external document number), allocate/deallocate, return to main warehouse
(`STOCK_OUT`, reason), write-off (reason), adjustments, transfers per Rule B. Every operation
shows a confirmation summary before commit. Cross-entity operations are visibly different and
blocked without a document reference when required. Relationship mode change with the C17
guard: `CONSIGNMENT → PURCHASE` is blocked while cross-entity allocations have open reservations
or commitments; the UI shows what must be drained.

**I6 — Physical counts.** Enable `PHYSICAL_COUNT`. A count covers one pool and one location at
a time (C13). Counting per decisions 6, 7 and 9. After the count the admin sees expected vs
counted per SKU and approves differences as `ADJUSTMENT` rows with a reason; Rule A applies;
any staging shortfall is a CRITICAL review (resolved in M9 through "Lost in staging").

**I7 — Minimum stock and replenishment.** Per-allocation minimum; status
`NORMAL → LOW_STOCK → OUT_OF_STOCK → NORMAL` based on `available_to_sell`, one notification per
transition. Replenishment requests to the owner entity's stock managers
(`OPEN → ACKNOWLEDGED → FULFILLED | DECLINED`), fulfilled by `STOCK_IN` + `ALLOCATE`.

**I8 — Sellability and projection.** Replace `ALLOCATION_OWNERS_UNAVAILABLE_M8` with the real
check: the storefront has an allocation for the SKU and the pool's owner entity has an active
accounting mapping (plus the seller mapping already required). Stock availability stays a
separate value in the projection (`available_to_sell`), never part of sellability. From this
point a product can be sellable for the first time; make that visible in review.

**I9 — Settings.** Operating-model text (decision 1), physical marking of each pool's shelf and
staging zones (C13), and "returned goods go to the main warehouse, never back to the online
shelf" (C1).

**Phase 2 tests**

- operations per role (STOCK_MANAGER own entity only; WAREHOUSE never sees balances);
- C17 guard blocks and allows after draining;
- count: re-scan opens the line, never increments; blind count hides expected quantities;
  `expected_at` excludes later movements; approved differences produce correct ADJUSTMENT rows;
- minimum-stock transitions notify once per transition; replenishment lifecycle;
- sellability: owner mapping missing → not sellable with that reason; all conditions met →
  sellable; availability reported separately.

**End of Phase 2:** same verification as Phase 1, update the milestone document and
`AGENTS.md`, move the PR out of draft only when the owner asks, and stop.

## 5. Rules for both phases

New migrations only. Never touch the shared database. No deployment. List any business
question in the PR instead of deciding it.

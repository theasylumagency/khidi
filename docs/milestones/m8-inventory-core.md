# M8 — Inventory core

## Gap inventory (before implementation)

Phase 1 starts from `main` at `cf1e98c` (M7 and the validator fix merged).
Branch: `m8-inventory-core`. The owner-provided task is
[`../task-m8-inventory-core.md`](../task-m8-inventory-core.md).

| Requirement | Existing base | Phase 1 work |
| --- | --- | --- |
| Ownership and allocation | Entities, effective-dated relationships and storefronts exist; inventory exports only the 15 type names. | New pools, locations, allocations, C2 materialized balances and append-only ledger migration. |
| Ledger rules | No stock mutation engine. | One C3/C14 matrix, transactional primitives, Rule A proposals/critical rejection and paired Rule B transfers; audit and STOCK_CHANGED. |
| Reconstruction | No ledger or verification command. | Read-only ledger rebuild and materialized-balance comparison, including missing/extra rows. |
| Cross-service locking | Pricing/corrections currently lock SKU rows before price advisory locks; the price trigger takes a SKU share lock. | Shared canonical helper, advisory keys before sorted SKU/pool/allocation rows, matching trigger path and concurrency tests. |
| SKU corrections | ADR-011 Part B remains Proposed; a dynamic pre-inventory guard exists. | Refuse a split with any inventory record, including zero-balance history; test the new tables and correction races. |
| Verification | Existing PostgreSQL tests and domain/idempotency infrastructure. | Matrix/precondition, concurrency, Rule A/B, database immutability and bounded property-based sequences with pinned fast-check. |

Only I1–I4 are authorized in this phase. Manual-operation screens, count tasks,
replenishment, relationship-mode UI and sellability integration wait for Phase 1 review.
Reservation/fulfillment engines remain M9; this phase supplies their ledger primitives.
No shared database access or deployment. Integer pieces only; length, weight and volume
require a later business decision. ADR-011 Part B is not implemented.

## I1 — Schema

`0033_inventory_core.sql` introduces pools, their two location kinds, stable allocation
identities, C2 balances, generated quantities and the 15-type append-only ledger with all
six deltas and C18 snapshot fields. Per-row constraints protect quantities; deferred
constraint triggers enforce pool allocated totals against allocation sums. Cross-entity
allocation creation requires the latest effective owner→seller CONSIGNMENT relationship.
The application cannot delete inventory records or update/delete ledger rows.
One focused schema test and inventory typecheck passed on `khidi_m8_work_test`.

## I2 — Ledger primitives

The engine and matrix tests read one 20-row matrix covering exactly 15 movement types,
including adjustment and transfer variants. Whole batches are simulated under locks before
ledger/audit/outbox writes. Rule A returns explicit candidates and required deallocation;
it never chooses an allocation. Missing held units persist a CRITICAL audited notification
event and write no stock movements. Rule B requires paired OUT/IN legs, equal quantities,
ownership/relationship checks and purchase documents on both legs.

Reservation quantities and per-request staged quantities come from ledger history.
COD/pickup COMMIT must immediately precede its matching HANDOVER in the same batch.
Count approval, scan verification and fulfillment cancellation are trusted, transactional
workflow adapters: an input flag alone cannot authorize these primitives. Phase 2 supplies
the count adapter; M9 supplies return/cancellation adapters and full lifecycle services.
No inventory API or UI exposes these assertions in Phase 1. Nullable future reservation,
fulfillment and count IDs have no foreign keys until their owning tables exist.

The shared lock helper is introduced for the engine here; I4 adopts it in existing services.
`fast-check` is pinned to 4.3.0 (older than two weeks; see its
[release notes](https://github.com/dubzzz/fast-check/releases/tag/v4.3.0)).
The bounded property test uses 16 runs with 10–28 random operations and checks invariants,
independent expected quantities and reconstruction from all six ledger deltas.

I2 verification: 31 focused schema/engine/property tests passed, including the two last-unit
races, all matrix variants, paired transfer history, COD atomic handover, transactional
workflow-proof rejection, role scope, idempotency and both append-only protections.

## I3 — Reconstruction and read-only verification

`rebuildBalancesFromLedger()` groups all six deltas from one ledger snapshot.
`verifyInventoryBalances()` compares that reconstruction with stored balances inside a
read-only, repeatable-read transaction. It reports per-field differences and missing
materializations; zero initialization rows without ledger history are valid. It never repairs.
`pnpm inventory:verify` requires an explicit `DATABASE_URL`, prints the result and exits
0 for agreement, 1 for differences and 2 for a failed verification. No fallback target.
Reconstruction and deliberate-drift tests passed; the property test also runs the verifier.

## I4 — Shared lock order and correction protection

Pricing, corrections, identity/evidence and inventory use the shared helper. Price keys are
per SKU, so corrections can acquire all of them before the SKU rows even when a storefront
has no price yet. The existing identity key is preserved for the accounting trigger.
`withdrawArchivedSkuPrices` inherits its correction's plan and acquires no late locks.
`0034_inventory_lock_guards.sql` aligns every price INSERT (including withdrawal) and
serializes allocation creation with the SKU row. Ledger dimensions are checked against
pool, allocation and location metadata. See [the lock contract](../architecture/locking.md).

Forced, observed advisory waits prove that a merge and a split with an older target each
allow the competing price commit to finish, then withdraw its price without a deadlock.
The direct INSERT trigger has the same test. Real allocations, zero pool rows and drained
ledger histories all refuse split under ADR-011 Part A; Part B is unchanged.

## Review question for the next phase

The task specifies split refusal but does not define how an existing SKU merge should
handle inventory or open held lines. No stock is moved or rewritten by catalog merge in
this phase. Before stock administration is exposed in Phase 2, the owner should decide
whether merges involving inventory must be refused or handled by a separately approved
ledger workflow. This PR does not invent a stock reassignment policy.

## Final Phase 1 verification

- Focused inventory, pricing and correction runs passed; the last engine/reconstruction
  run passed 32 tests, followed by 30 engine tests after the final allocation-plan guard.
- Repository typecheck, lint (including dependency boundaries) and production build passed.
  The boundary check examined 368 modules without violations.
- One full run on fresh local `khidi_m8_final_test`: **464 passed, 1 failed, 1 skipped**
  across 80 files. Every M8 test passed. The skipped case was the optional S3 integration
  without MinIO. The failure was the existing passkey inactivity fixture: it used the DB
  clock to set exactly 20 minutes while authentication checks application time; the reported
  deadline was still 68 ms in the future. The unchanged test passed a focused retry.
- That fixture now uses application time, safely beyond the deadline, like the existing
  session-activity fixtures. A separate deterministic assertion preserves exact-boundary
  coverage (accepted at deadline minus 1 ms; rejected at the deadline). No authentication
  behavior changed. **38 passkey/session-activity tests and auth typecheck passed** afterwards.
  This small test-only deviation is included to remove the observed clock-dependent failure.
  The full suite was not repeated, following the owner's verification budget.
- `inventory:verify` returned `ok: true` and exit 0 on the newly migrated/seeded database.
  Focused tests also verified drift, missing rows and unchanged data after verification.

## Phase boundary

I1–I4 are ready for Draft PR review. I5–I9, count and replenishment screens, relationship
mode changes, sellability integration and M9 engines are not started. No new ADR was needed
for the specified Phase 1 decisions; ADR-011 Part B stays Proposed. No deployment or shared
database access occurred. The next phase requires explicit owner approval.

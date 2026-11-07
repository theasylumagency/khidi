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

## Merge/archive rule — resolved by the owner during Phase 2

History alone never blocks a merge or archive. The source must have zero shelf, staging,
allocated, reserved and committed quantities everywhere, and no open fulfillment. The
survivor may hold stock; a merge never moves stock or changes the survivor's availability.
Ledger history stays on the archived source and remains traceable through merge lineage.
Migration 0037 enforces the drained condition in the database as well as the domain.

Manual procedure:

1. Set the source's free-to-sell availability to zero on every storefront.
2. Let open orders complete or cancel. A cancellation may release units back to free stock:
   set availability to zero again if necessary. Remove any unallocated advanced-operation
   buffer too; every source balance must be zero before continuing.
3. Merge into the survivor. Its existing stock is left unchanged.
4. Declare the survivor's availability explicitly under ADR-013.

Archiving uses the same drained-source rule. ADR-011's stricter pre-inventory split rule
is unchanged; Part B remains Proposed.

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

## Phase 1 review stop

I1–I4 were delivered for Draft PR review. Phase 2 began only after the owner's explicit
authorization below. No deployment or shared database access occurred.

## Phase 2 — owner approval and ADR-013 gap inventory

The owner authorized Phase 2 in this chat under Accepted ADR-013, which replaces the
physical-warehouse operating model. Work continues on `m8-inventory-core`, PR #15 stays draft.

| Requirement | Existing base | Phase 2 extension |
| --- | --- | --- |
| Declared availability | Ledger and canonical locks; no configured pool or stock screen | Configured storefront pool with drained reconfiguration, idempotent absolute free-to-sell targets, locked derived movements, multi-pool refusal and Georgian confirmation table. |
| Advanced operations | Tested primitives | ADMIN-only operations/Rule B transfers, pool setup and enforced C17 mode guard. |
| Counts | PHYSICAL_COUNT disabled; future proof hooks exist | Keep disabled; no counts, count proposals or marked-shelf requirements under ADR-013. |
| Alerts/replenishment | Event names and allocation minimum exist | Stock-status transitions and owner-manager notifications; request lifecycle without movements; availability can fulfill a referenced request. |
| Publishing | M8 owner blocker and caller-supplied commerce placeholder | Actual allocations, owner mappings and separate availability, including zero stock. |
| Settings | Physical warehouse wording | Declared limits and the accepted risk of declaring more units than physically exist. |

## I5 — Declared availability and advanced operations

The primary domain entry requires an idempotency key and computes the delta only after
locking the configured allocation and every relevant pool. It writes the exact ADR-013
pairs, preserves reserved/committed units and returns the original result on replay, even
after an intervening reservation. Other storefronts' balances are not updated.

Migrations 0035–0038 add configuration and notification/request storage, compatible SKU
lock strength, the drained-source guard, and the owner's amended pool/binding guards.
SKU locks use `FOR NO KEY UPDATE`, so allocation-only reservations can insert their
ledger FK references without forming a SKU→allocation→SKU cycle. A forced overlap test
reproduced that cycle before the fix and now passes.

The owner amended ADR-013 §6 during implementation: configuration can move only when
the storefront's allocations in the old pool are drained. Existing stock in a destination
must also be drained so its new declared availability starts at zero. No stock is moved
by configuration. Shared pools may retain another storefront's stock. A mode change away
from CONSIGNMENT is refused until every affected storefront binding has moved.
The branch copy of ADR-013 records this amendment; older migrations remain frozen.

Availability/advanced operations hold a shared configuration advisory lock; configuration
and mode changes hold it exclusively, before the remaining sorted keys and balance rows.
This keeps a pool selection stable while an availability target is calculated and applied.

The Georgian desktop table shows free, reserved and committed units, a target, a change
summary and confirmation. ADMIN has a separate advanced section with current per-pool
balances, receive/remove/write-off, allocation, Rule B transfers, pool configuration and
relationship changes. The API authenticates roles, origins and request keys; domain checks
remain authoritative. WAREHOUSE cannot read balances. STOCK_MANAGER stays within its entity;
cross-entity actions and the advanced section require ADMIN.

Focused availability, configuration, source-drain, API and confirmation tests passed.
Desktop smoke: a real local login, preview `7 → 10 (+3)`, commit and reload retained three
reserved units and showed ten free units. A duplicate-name React key was corrected and the
reloaded screen emitted no new warnings/errors.

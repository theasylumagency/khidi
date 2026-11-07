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

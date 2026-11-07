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

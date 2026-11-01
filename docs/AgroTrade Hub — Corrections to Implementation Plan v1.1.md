# AgroTrade Hub — Corrections to Implementation Plan

Nov 1, 2026 · @George

Revise the implementation plan with the 18 corrections below. Specification v1.2 remains the source of truth; where a correction differs from v1.2 or from the plan, the correction wins. These corrections will be merged into specification v1.3.

## How to apply

Produce a complete revised plan, not a diff. Keep the current structure (module boundaries, schema, ledger matrix, milestones, risks) and everything not mentioned here.

- Tag every changed item with its correction ID (C1–C18).
- Do not add business semantics that are not in the specification or in these corrections. If a case is not covered, list it under Open questions instead of deciding it.
- Write the plan in Georgian; keep code, SQL, identifiers and movement types in English.

| ID | Correction | Severity |
| --- | --- | --- |
| C1 | Returns after handover are outside the Hub; remove RETURN\_RESTOCK and MANUAL\_RESTORE | Critical |
| C2 | Pool-level invariant: allocated total never exceeds physical on-hand | Critical |
| C3 | Complete invariant matrix for all 15 movement types, with preconditions | Critical |
| C4 | COD / pay on pickup: commit and handover in one transaction; cancel paths | Critical |
| C5 | Remove the package dependency cycle around sellability | High |
| C6 | Gateway + PWA spike in M1; backups before first real data | High |
| C7 | Enforce ledger immutability in the database | High |
| C8 | Canonical slug assigned at approval, not at intake | High |
| C9 | Rename accounting\_mappings.owner\_entity\_id | Medium |
| C10 | Per-consumer outbox delivery status | Medium |
| C11 | VAT default per legal entity | Medium |
| C12 | Single user role: document as ADR | Low |
| C13 | Physically separable pools for counting | Medium |
| C14 | Unit lost in staging: admin staging adjustment, no fake return | High |
| C15 | Bundles: storefront sends bundle SKU; Hub expands from reservation snapshot | Medium |
| C16 | Partial-pick cancellation: return rule per unit, not per status | High |
| C17 | Relationship mode change: no live switching; preconditions per direction | Medium |
| C18 | Sellability checked at RESERVE only; accounting snapshot on COMMIT | High |

## C1 — Returns after handover are outside the Hub

The online space is a closed system: units enter only by STOCK\_IN and leave only by HANDOVER\_OUT. After handover the Hub never reacts to what happens to the unit.

- **Boundary is HANDED\_OVER.** Before it (RESERVED, COMMITTED, PICKED) the unit is still in the online space; cancellations, RETURN\_TO\_SHELF and releases remain Hub operations.
- **After it**, customer returns, refunds, inspection, write-off or offline resale are handled by the storefront's order system and the entities' accounting. The Hub records nothing.
- **Re-entry:** a returned unit that should be sold online again enters through a normal STOCK\_IN with a document reference, like any new unit.
- **Remove** `RETURN_RESTOCK` and `MANUAL_RESTORE` from the schema, the CHECK constraint, the matrix and the tests. Cancellation before handover is fully covered by RESERVATION\_RELEASE, COMMIT\_RELEASE and RETURN\_TO\_SHELF.
- **Reports** show no return information. Accountants take refunds from storefront records.
- **Operational rule** (Settings text + warehouse onboarding): returned goods go to the main warehouse, never directly back to the online shelf. A unit put back on the shelf without STOCK\_IN will appear as surplus in the next count.

## C2 — Pool-level invariant

The current plan protects each allocation but not the pool. Concurrent STOCK\_OUT and ALLOCATE can assign more units than exist on the shelf. Add one locked balance row per pool and SKU.

```sql
CREATE TABLE pool_sku_balances (
  pool_id          UUID NOT NULL REFERENCES stock_pools(id),
  sku_id           UUID NOT NULL REFERENCES skus(id),
  shelf            INTEGER NOT NULL DEFAULT 0 CHECK (shelf >= 0),
  staging          INTEGER NOT NULL DEFAULT 0 CHECK (staging >= 0),
  allocated_total  INTEGER NOT NULL DEFAULT 0 CHECK (allocated_total >= 0),
  unallocated      INTEGER GENERATED ALWAYS AS (shelf + staging - allocated_total) STORED,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pool_id, sku_id),
  CHECK (allocated_total <= shelf + staging),
  CHECK (staging <= allocated_total)
);
```

This replaces `pool_location_balances` as the locked aggregate; per-location detail stays derivable from the ledger.

**Invariants** (enforced by CHECK constraints and domain tests):

1. `shelf ≥ 0`, `staging ≥ 0`.
2. `allocated_total = Σ allocation_balances.allocated` for the pool and SKU.
3. `allocated_total ≤ shelf + staging` — never more allocated than physically present.
4. `staging ≤ allocated_total` — staged units are always allocated units being fulfilled.
5. Per allocation: `reserved ≥ 0`, `committed ≥ 0`, `allocated − reserved − committed ≥ 0`.
6. Materialized balances rebuilt from the ledger equal the stored balances.

**Locking order** for every stock operation, to avoid deadlocks:

1. `pool_sku_balances` rows, ordered by (pool\_id, sku\_id).
2. `allocation_balances` rows, ordered by allocation\_id.

Every physical or allocation movement locks the pool row, even if it changes only one allocation. Reservation-only movements (RESERVE, RESERVATION\_RELEASE, COMMIT, COMMIT\_RELEASE) lock only allocation rows.

## C3 — Complete invariant matrix (15 movement types)

The ledger has exactly 15 movement types. Every type below defines its deltas and the precondition checked under lock. A movement whose result would break any C2 invariant is rejected, never clamped.

```text
Physical     STOCK_IN  STOCK_OUT  WRITE_OFF  ADJUSTMENT
             PICK_TO_STAGING  RETURN_TO_SHELF  HANDOVER_OUT
Allocation   ALLOCATE  DEALLOCATE  TRANSFER_OUT  TRANSFER_IN
Commitment   RESERVE  RESERVATION_RELEASE  COMMIT  COMMIT_RELEASE
```

Columns: shelf, staging and alloc\_total are pool-level (`pool_sku_balances`); allocated, reserved and committed are on one allocation (`allocation_balances`). n > 0.

| Type | shelf | staging | alloc\_total | allocated | reserved | committed | Precondition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| STOCK\_IN | +n | 0 | 0 | 0 | 0 | 0 | — |
| STOCK\_OUT | −n | 0 | 0 | 0 | 0 | 0 | n ≤ unallocated |
| WRITE\_OFF | −n | 0 | 0 | 0 | 0 | 0 | n ≤ unallocated; reason required |
| ADJUSTMENT (shelf, +) | +n | 0 | 0 | 0 | 0 | 0 | Approved count line; reason |
| ADJUSTMENT (shelf, −) | −n | 0 | 0 | 0 | 0 | 0 | n ≤ unallocated (see rule A) |
| ALLOCATE | 0 | 0 | +n | +n | 0 | 0 | n ≤ unallocated |
| DEALLOCATE | 0 | 0 | −n | −n | 0 | 0 | n ≤ available\_to\_sell |
| TRANSFER\_OUT (same pool) | 0 | 0 | −n | −n | 0 | 0 | n ≤ available\_to\_sell of source allocation |
| TRANSFER\_IN (same pool) | 0 | 0 | +n | +n | 0 | 0 | Paired with TRANSFER\_OUT, same correlation id |
| TRANSFER\_OUT (to other pool) | −n | 0 | 0 | 0 | 0 | 0 | n ≤ unallocated of source pool; document ref (rule B) |
| TRANSFER\_IN (from other pool) | +n | 0 | 0 | 0 | 0 | 0 | Paired; target pool owned by receiving entity |
| RESERVE | 0 | 0 | 0 | 0 | +n | 0 | n ≤ available\_to\_sell |
| RESERVATION\_RELEASE | 0 | 0 | 0 | 0 | −n | 0 | n ≤ reserved; line not in staging (or RETURN\_TO\_SHELF first) |
| COMMIT | 0 | 0 | 0 | 0 | −n | +n | n ≤ reserved |
| COMMIT\_RELEASE | 0 | 0 | 0 | 0 | 0 | −n | n ≤ committed; line not in staging (or RETURN\_TO\_SHELF first) |
| PICK\_TO\_STAGING | −n | +n | 0 | 0 | 0 | 0 | Line is COMMITTED, or RESERVED under COD/pickup (C4) |
| RETURN\_TO\_SHELF | +n | −n | 0 | 0 | 0 | 0 | n ≤ staged units of the fulfillment request; scan-confirmed |
| HANDOVER\_OUT | 0 | −n | −n | −n | 0 | −n | n ≤ committed and n ≤ staged units of the request |

`available_to_sell = allocated − reserved − committed`; `unallocated = shelf + staging − alloc_total`.

**Rule A — negative shelf adjustment beyond unallocated.** If a count finds fewer units than expected and the shortfall exceeds `unallocated`, the system proposes DEALLOCATE rows from allocations with `available_to_sell > 0` (admin chooses which), then the ADJUSTMENT, all in one transaction. If units that are reserved or committed are missing, the adjustment is blocked and a CRITICAL notification is raised: an order cannot be fulfilled and a human must cancel or source it. Staging adjustments are never automatic; a staging shortfall is a CRITICAL review linked to its fulfillment request and is resolved only through the admin "Lost in staging" procedure (C14).

**Rule B — transfers.**

- *Same owner* (Store A → Store B within one pool): TRANSFER\_OUT + TRANSFER\_IN between allocations; physical stock and alloc\_total unchanged.
- *CONSIGNMENT*: the new-brand storefront's allocation lives in the AgroTrade pool. Transfers are same-pool reallocations, flagged `cross_entity = true`, `relationship_mode = CONSIGNMENT`. Allocating from a pool to a storefront of another entity is allowed only when an active CONSIGNMENT relationship exists.
- *PURCHASE*: units move from the AgroTrade pool to the new-brand pool. Source units must be unallocated (deallocate first). TRANSFER\_OUT on the source pool and TRANSFER\_IN on the target pool in one transaction, both with the external document reference; the receiving entity then allocates with ALLOCATE.

Every ledger row records owner\_entity\_id, seller\_entity\_id (when a storefront is involved), storefront\_id, relationship\_mode, cross\_entity and correlation\_id.

## C4 — Cash on delivery and pay on pickup

Under CASH\_ON\_DELIVERY and PAY\_ON\_PICKUP a line stays RESERVED through picking; it is never COMMITTED before handover. The current matrix assumes HANDOVER\_OUT always consumes a commitment, so these flows need explicit rules.

- **Handover:** write COMMIT and then HANDOVER\_OUT for the same lines in one transaction. The sale date and the physical exit date are the same moment.
- **Picking:** PICK\_TO\_STAGING is allowed for RESERVED lines of these payment methods only.
- **Cancel before pick:** RESERVATION\_RELEASE.
- **Cancel after pick:** RETURN\_TO\_SHELF (scan-confirmed), then RESERVATION\_RELEASE. Fix risk R4 in the plan accordingly: it currently mentions only COMMIT\_RELEASE.
- **Reservation timeout** must not expire a line that is already in staging; the fulfillment request moves to an ACTION\_REQUIRED state instead.
- **Handover point:** implement handover as the moment the unit is given to the courier (or to the customer for pickup). A refused or failed delivery is treated like any return under C1: outside the Hub.

Open decision (add to §18 as #7): whether COD should commit at courier pickup or at confirmed customer delivery. Build only the courier-pickup behaviour now; do not build the alternative.

## C5 — Package dependency cycle

The Storefront Sellability Evaluator sits in `packages/products`, but it needs prices (`pricing`), listings (`entities`) and accounting mappings, while `pricing` already depends on `products`. That is a cycle.

- Create `packages/publishing` above the catalog and commerce layers. It owns the Sellability Evaluator (§15.2) and the storefront product projection served by the API (facts + base price + availability + public media URLs).
- `publishing` may depend on `products`, `entities`, `pricing`, `inventory` and `media`. None of them may depend on `publishing`.
- `products` must not import `pricing`, `inventory` or `fulfillment`.
- Redraw the dependency graph and add a boundary check in CI (dependency-cruiser or an ESLint boundaries rule) that fails on any cycle or forbidden import.

## C6 — Milestone order: gateway spike and backups earlier

Two items in M11 are too late. Move their first version forward; M11 keeps the full re-verification.

| Item | Current | New | Why |
| --- | --- | --- | --- |
| Gateway + PWA spike | M11 | M1 | If the gateway breaks install, camera or push, we must know before building the scanning UI. Deploy the empty PWA shell behind the chosen gateway and verify on a real Android phone and a real iPhone: install, service worker, camera permission, IndexedDB write/read, one test push. Record the gateway configuration in an ADR. |
| Automated backups (PITR + nightly full + object versioning) | M11 | End of M3, before any pilot intake | Real intake data and raw photos start accumulating from M3–M5 and cannot be recreated. |
| Restore test | M11 | First test before pilot intake; full test in M11 and before go-live | A backup that was never restored is unproven. |

M11 still runs the gateway check on the final app, the restore test from a clean environment, and the four end-to-end scenarios.

## C7 — Ledger immutability in the database

The plan adds append-only triggers only to `audit_logs`. The stock ledger is the authoritative source and needs the same protection.

- Append-only (no UPDATE, no DELETE) on: `stock_ledger`, `audit_logs`, `storefront_prices`, `sku_slug_history`.
- Enforce twice: a trigger that raises on UPDATE/DELETE, and a database role for the application without UPDATE/DELETE privileges on these tables. Migrations run under a separate owner role.
- Corrections are always new rows (e.g. ADJUSTMENT with a reason), never edits.
- Test: an UPDATE on `stock_ledger` from the application role fails.

## C8 — Canonical slug assigned at approval

`skus.canonical_slug` is `NOT NULL UNIQUE` from the first intake, before brand and model are known. Because slugs are meant to be stable, a slug generated from unverified data could stay forever.

- Make `canonical_slug` nullable; keep a partial unique index `WHERE canonical_slug IS NOT NULL`.
- Generate it only when the SKU reaches READY, from verified brand and model (or the naming fallback in §5.11).
- After READY, any change goes through `sku_slug_history`.
- Sellability requires a non-null slug.

## C9–C13 — Smaller corrections

**C9 — Accounting mapping column name.** Rename `accounting_mappings.owner_entity_id` to `legal_entity_id`. Since v1.2 a mapping is needed for the seller entity and, when different, the owner entity; "owner" in the column name would mislead implementation. Index on `(sku_id, legal_entity_id) WHERE active`.

**C10 — Per-consumer outbox delivery.** One event can have several consumers (webhook to Storefront A, webhook to Storefront B, notifications). A single `status` on `outbox_events` cannot track them. Keep `outbox_events` immutable and add:

```sql
CREATE TABLE outbox_deliveries (
  id               UUID PRIMARY KEY,
  outbox_event_id  UUID NOT NULL REFERENCES outbox_events(id),
  consumer         TEXT NOT NULL,   -- 'storefront:<id>' | 'notifications' | ...
  status           TEXT NOT NULL CHECK (status IN ('PENDING','DELIVERED','DEAD_LETTER')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at     TIMESTAMPTZ,
  UNIQUE (outbox_event_id, consumer)
);
```

`webhook_deliveries` stays as the per-attempt log.

**C11 — VAT default per legal entity.** Remove `vat_included DEFAULT TRUE`. Add `legal_entities.prices_include_vat BOOLEAN NOT NULL` (set per entity; the new-brand company may not be VAT-registered). A new price row takes the default from the storefront's seller entity; the admin can override it.

**C12 — Single user role.** Keeping one global `users.role` plus entity memberships is acceptable for Phase 1. Write ADR-001 stating the limitation (a person cannot be STOCK\_MANAGER in one entity and OPERATOR in the other) and the migration path to roles per membership.

**C13 — Physically separable pools.** Counts are per pool and location. Under PURCHASE there are two pools (AgroTrade and new-brand) whose units may sit in the same room. The count UI must count one pool at a time, and the Settings operating-model text must state that each pool's shelf and staging zones are physically marked so staff can tell the owners apart. Add this to open decision #3.

## C14–C18 — Answers to the plan's open questions

**C14 — Unit lost or destroyed in STAGING.** Do not fake a return to the shelf: that would record a movement that never happened. Add an explicit staging variant of ADJUSTMENT, admin-only, reason mandatory, in one transaction with the cancellation of the affected line.

| Type | shelf | staging | alloc\_total | allocated | reserved | committed | Precondition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ADJUSTMENT (staging, −) | 0 | −n | −n | −n | 0 / −n (COD) | −n / 0 (COD) | ADMIN only; reason; n ≤ staged units of the line |

Add this row to the C3 matrix; the count of movement types stays 15. The fulfillment request becomes CANCELLED with reason `UNIT_LOST`, and the storefront receives a webhook. If the storefront still wants to fulfil the order, it creates a new reservation through the normal flow. The procedure is exposed in the UI as "Lost in staging" on the fulfillment request.

**C15 — Composed bundles in fulfillment requests.** The storefront sends the bundle SKU, never its components; storefronts do not know bundle composition. The Hub expands the bundle into component lines at reservation time and stores that snapshot in `reservation_lines.parent_bundle_sku_id`. Picking, fulfillment and handover use the reservation snapshot, not the current bundle definition, which may have changed since. Reports show the storefront-reported bundle price on the bundle line; how to split it across components is open decision #8.

**C16 — Cancelling a partially picked request.** The return rule is per unit, not per request status. On cancellation, every unit currently in STAGING requires a scan-confirmed RETURN\_TO\_SHELF, whether the request is PICKING or PICKED. Units not yet picked are released immediately. Track this with `picked_quantity` and `returned_quantity` per line.

**C17 — Changing the relationship mode.** Mode changes are rare; no live switching in Phase 1.

- A mode change never rewrites history: each ledger row keeps the `relationship_mode` it was written with. The new mode applies to movements from `effective_from` onward.
- **CONSIGNMENT → PURCHASE:** the system blocks the change while any new-brand storefront allocation in the AgroTrade pool has open reservations or commitments. Procedure: stop new reservations on those allocations, let open ones finish, DEALLOCATE, switch the mode, then move stock with a PURCHASE transfer and document reference.
- **PURCHASE → CONSIGNMENT:** the new-brand pool stays as it is (its own purchased goods). The change only permits future allocations from the AgroTrade pool to the new-brand storefront.

**C18 — Listing or mapping disabled during an active reservation.** Sellability is checked only at RESERVE. Lines already RESERVED or COMMITTED complete normally through COMMIT and HANDOVER\_OUT; disabling a listing or mapping blocks only new reservations. At COMMIT, write a snapshot onto the ledger row: `seller_accounting_item_id`, `seller_accounting_name`, `owner_accounting_item_id`, `owner_accounting_name`. Reports read the snapshot, never the current mapping.

## Tests to add and remove

**Remove:** every test for RETURN\_RESTOCK and MANUAL\_RESTORE (C1).

**Add:**

| Area | Test | Correction |
| --- | --- | --- |
| Inventory | Concurrent STOCK\_OUT and ALLOCATE on the last unallocated unit: exactly one succeeds, invariants hold | C2 |
| Inventory | Each of the 15 movement types: deltas match the matrix; every precondition rejects when violated | C3 |
| Inventory | Property-based test: random sequences of valid operations never break invariants 1–6; ledger rebuild equals materialized balances | C2, C3 |
| Inventory | Negative shelf adjustment beyond unallocated proposes DEALLOCATE; blocked with CRITICAL when reserved/committed units are missing | C3 |
| Inventory | Same-pool transfer, CONSIGNMENT allocation to the other entity's storefront, PURCHASE transfer between pools with document ref | C3 |
| Inventory | Lost in staging (card and COD): staging adjustment closes the line, request CANCELLED with UNIT\_LOST, webhook sent, invariants hold; non-admin is rejected | C14 |
| Fulfillment | COD: pick while RESERVED; handover writes COMMIT + HANDOVER\_OUT in one transaction | C4 |
| Fulfillment | COD cancel after pick: RETURN\_TO\_SHELF, then RESERVATION\_RELEASE; timeout does not expire a staged line | C4 |
| Fulfillment | Cancel while PICKING with 1 of 3 units staged: 1 requires scan-confirmed return, 2 release immediately | C16 |
| Bundles | Fulfillment request with a bundle SKU expands from the reservation snapshot even after the bundle definition changed | C15 |
| Entities | CONSIGNMENT → PURCHASE blocked while cross-entity allocations have open reservations or commitments; allowed after draining | C17 |
| Sellability | Listing or mapping disabled after RESERVE: the line still commits and hands over; new RESERVE is rejected | C18 |
| Reports | Report after a mapping change shows the accounting snapshot written at COMMIT | C18 |
| Returns | After HANDED\_OVER, no API call or UI action can change Hub stock for that line | C1 |
| Architecture | CI fails on a dependency cycle or forbidden import | C5 |
| Database | UPDATE/DELETE on append-only tables fails from the application role | C7 |
| Products | SKU in INTAKE has no slug; slug generated at READY; later change writes slug history | C8 |
| Outbox | One event to two storefronts: one delivery fails, the other succeeds, retries are independent | C10 |
| Pricing | New price row takes VAT default from the seller entity | C11 |

## Expected output

Return one revised implementation plan containing:

1. A changelog table at the top: correction ID → what changed → plan section.
2. Updated module boundaries and dependency graph, including `packages/publishing` (C5).
3. Updated SQL schema: `pool_sku_balances`, `outbox_deliveries`, accounting snapshot columns on `stock_ledger`, renamed and removed columns, CHECK constraints for 15 movement types, append-only enforcement (C2, C3, C7–C11, C18).
4. The full invariant matrix exactly as in C3, including the C14 staging adjustment row and rules A and B, with no movement type left undefined.
5. Updated fulfillment rules: per-unit return on cancellation, bundle expansion from the reservation snapshot, "Lost in staging" procedure (C14–C16).
6. Updated milestones with the M1 gateway spike and the M3 backups (C6).
7. Updated risks: R1 and R3 reflect the pool lock, R4 covers COD and partial picks, new risks for pool oversubscription, staging loss and relationship-mode change.
8. Updated open decisions: add #7 (COD commit point), #8 (bundle price split across components in reports), and the shelf-marking note under #3.
9. **Open questions**: any case these corrections and the specification do not cover. List them; do not resolve them yourself.

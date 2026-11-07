# ADR-013: Online stock is an admin-declared limit

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decided by:** project owner
- **Changes:** Specification §10.1, §10.4, §10.11; M8 Phase 2 scope (I5, I6, I9)
- **Keeps:** the M8 Phase 1 ledger, invariants and locking unchanged

## Context

The Hub exists to keep order on the online side without touching the client's offline
processes, which are not orderly and are not ours to fix. Trying to reconcile the Hub with the
physical warehouse (physical counts, marked online shelves, accounting transfers) would import
that disorder into the Hub and burden the client's staff with work they will not do reliably.

## Decision

1. **The admin's number is the fact.** For each SKU and storefront, an authorized user declares
   how many units are available for online sale. The Hub accepts it as confirmed information and
   asks no further questions. It does not read, estimate or verify physical stock.
2. **Primary operation: "set online availability".** The user enters the target
   `available_to_sell` for a SKU on a storefront. The Hub derives the ledger movements that reach
   it in one transaction, with reason "availability set" and audit:
   - increase by n → `STOCK_IN` n + `ALLOCATE` n;
   - decrease by n → `DEALLOCATE` n + `STOCK_OUT` n.
   The target cannot be negative. Units already reserved or committed are not part of
   availability and are never touched by this operation. Example: 10 units, 3 reserved, 7 free;
   the admin enters 10 → free becomes 10 and the 3 reserved stay reserved (13 in total).
   - **One transaction.** Reading the current value, computing the difference and writing the
     movements happen in one transaction under the normal locks, so a concurrent reservation or
     a second admin change cannot be lost.
   - **Idempotency.** Every request carries an idempotency key; a replay returns the original
     result and never applies the difference again. No "expected current value" check is
     required: the target is absolute, and if a sale happened meanwhile, reaching the declared
     number is still what the admin asked for.
   - **UI wording.** The field is labelled as free-to-sell availability, next to the current
     free, reserved and committed quantities, and the confirmation shows the change
     (e.g. "თავისუფლად გასაყიდი: 7 → 10 (+3)").
3. **The ledger stays strict.** The 15 movement types, invariants, locking and audit of Phase 1
   are unchanged. Order is enforced on our side; the simplification is only in what the user is
   asked to provide.
4. **Not built now:** physical counts (`PHYSICAL_COUNT` stays disabled), marked online shelves,
   requirements on the client's accounting, Rule A proposals from counts. Pool locations
   `SHELF`/`STAGING` remain as fulfillment states (picked vs not picked), not as physical zones.
5. **Kept:** low-stock and out-of-stock notifications based on `available_to_sell`, and
   replenishment requests to the owner entity's stock managers. A replenishment request is only
   a notification and a work item: it **never creates movements**. Stock changes only when an
   authorized user sets a new availability; that action may reference the request and close it
   as FULFILLED. Cross-entity operations (Rule B) stay available to ADMIN only.
6. **Which pool and allocation.** Each storefront has one configured **availability pool**
   (`storefronts.availability_pool_id`, configured by an admin): a pool of its own seller entity,
   or a pool of another entity under an active CONSIGNMENT relationship. "Set availability" for
   a SKU on that storefront always works on the allocation (availability pool, storefront, SKU),
   creating it on first use. It never touches other storefronts' allocations, even in the same
   pool. If the SKU also has free-to-sell units in other pools for the same storefront (created
   through the advanced section), the operation is refused with an explanation, because the
   declared number would be ambiguous; the admin resolves it in the advanced section. Until a
   storefront has an availability pool, the screen shows a configuration prompt instead of
   asking per SKU.
   - **Changing the pool:** ADMIN may change it only when that storefront's allocations in
     the current pool are fully drained: zero allocated, reserved, committed and staged units,
     and no open fulfillment. History stays where it is. The change is audited and availability
     in the destination starts at zero; existing destination stock must be drained first too.
     Other storefronts' allocations are never moved or changed.
   - **Relationship changes:** switching away from CONSIGNMENT is blocked while any storefront
     of the receiving entity uses a pool of the owning entity as its availability pool.
     The admin drains and moves those storefront bindings first, then changes the relationship.
7. **Extension points for later** (no implementation now): physical counts and Rule A, import of
   balances from accounting, and reconciliation reports. The schema already contains
   `count_line_id`, the ADJUSTMENT variants and the workflow proof hooks; adding them later must
   not require changing the ledger.

## Accepted risk

If the declared number is higher than what physically exists (for example after offline sales),
the Hub can sell a unit that is not there. The Hub cannot detect this. The mitigation is
business-side: declare conservative numbers and update them when offline sales happen. This risk
is stated on the settings page and in the admin's availability screen.

## Consequences

- Phase 2 UI centres on one table: SKU × storefront with current availability, reserved,
  committed, and an editable target — instead of warehouse operations.
- Detailed operations (receive, write-off, transfers) remain as an advanced ADMIN section.
- Settings text describes this model and the accepted risk instead of physical marking rules.

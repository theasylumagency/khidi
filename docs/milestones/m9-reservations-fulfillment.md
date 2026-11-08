# M9 — Reservations and fulfillment

## Gap inventory (before implementation)

Base: main at e17a1e8, after owner-reviewed PR #15. Branch: m9-reservations-fulfillment.
Implement Phase 1 (R1–R5), open a Draft PR and stop for owner review. API transport,
webhook delivery and admin screens wait for Phase 2; warehouse PICK UI stays deferred.

| Area | Existing base | Phase 1 work |
| --- | --- | --- |
| Stock | All 15 ledger primitives, line-level history, strict balances, reconstruction and canonical locking. | Reuse the engine; add a private workflow principal entry point, genuine unit proofs and frozen COMMIT snapshots. |
| Reservations | No reservation lifecycle; nullable future references on ledger. | Header, immutable cart/component/accounting snapshots, configurable timeouts, extend/release/commit/expiry and idempotency. |
| Fulfillment | Status names only. | Exactly one request per reservation, one-to-one reservation-line references, controlled pick/return/cancel/loss and simplified automatic completion. |
| Principals | Ledger requires an ADMIN or STOCK_MANAGER user; audit supports staff/storefront only. | USER, STOREFRONT_SERVICE, SYSTEM_JOB and SYSTEM_WORKFLOW with movement allowlists, storefront scope and recorded trigger/executor. No invented staff user. |
| Sellability | Ordinary SKU evaluator uses its own allocation; mappings have no primary choice. | Bundle component eligibility, availability-pool-only balances and unambiguous primary accounting selection. |
| Jobs | pg-boss media/AI runtime and durable dispatch patterns. | Transactional expiry intent, pg-boss queue/deployment, safe replay and expiry/confirmation serialization. |
| Verification | Independent inventory model, 25 default runs and replayable seed. | Reservation/fulfillment model in both modes, all specified regressions, 1000-run stress check, final fresh-database full suite and static/build checks. |

## Owner confirmations

- Fulfillment data has the same shape in both modes. The call that confirms the order carries
  delivery method, ship_by and final prices: RESERVE for COD/PICKUP, COMMIT for CARD/BANK.
  Simplified mode completes within that same idempotent transaction and returns HANDED_OVER
  with AUTO_ASSUMED. Controlled mode creates a REQUESTED fulfillment (COD lines stay RESERVED;
  CARD/BANK lines commit). No second confirmation call is needed for COD/PICKUP.
- Exactly one fulfillment request per reservation, containing every snapshot line. One unique
  constraint and one domain check enforce this. Fulfillment lines reference reservation lines
  one-to-one. Partial shipments and consolidation are future ADRs, not assumptions in the ledger.
- The mode is Hub-wide, default SIMPLIFIED_FULFILLMENT, and frozen at reservation creation.
  Controlled fulfillment remains implemented and tested. No physical tasks are created in
  simplified mode, and no customer data is accepted.

## Document provenance

The owner's amended M9 text was supplied in the local ADR-009-session-inactivity.md path.
It is recorded here as docs/task-m9-reservations-fulfillment-api.md; the accepted session ADR
from main is preserved. Accepted ADR-014 overrides the older M9 picking-UI scope. ADR-013
retains the final M8 amendments from main; the older local copy does not replace them. The original root worktree is left untouched.

## Architecture and verification record

R1–R5 implementation and verification results will be appended as each step completes.

### R1 — schema and principals

New migrations 0039/0040 add immutable reservation/cart/accounting snapshots, one-to-one
fulfillment lines, genuine principals, append-only history and durable unit proofs.
The DB requires proofs from the current transaction and prevents proof reuse. Controlled
AUTO_ASSUMED and warehouse manual confirmations are rejected. The staff primitive entry
point stays separate; dependency rules restrict workflow/core imports.

Focused engine, principal and independent inventory-model tests: 34 passed, including
25 generated programs (seed -1214575146). Historical primitive fixtures now create real
reservation and confirmation rows; the generator uses the approved single request per
reservation. Wrong-request rejection remains covered. Applied migration checksums are frozen.

### R2 — reservation engine

A separate reservations module sits above publishing/inventory; its transaction capability
is private to the fulfillment facade. Strict schemas reject personal-data fields and
unsafe order references. RESERVE snapshots cart/base price, expanded components and both
selected accounting mappings. COMMIT uses those frozen snapshots. Durable append-only
command receipts prevent re-execution after the generic idempotency cache expires.

Publishing evaluates only the configured availability pool. Composed bundles use
component readiness/allocation/mappings and min(floor(available/component quantity));
components need no listing or price. Factory kits stay ordinary stock. ADMIN can select
an audited primary mapping; ambiguity blocks reserving. No external library versions
changed: the new module reuses the pinned database/validation libraries, including the
existing PostgreSQL peer version.

Focused reservations, publishing and catalog checks: 62 passed. Reservation typecheck
and dependency boundaries passed. The projection fixture now binds its own isolated
storefront to its availability pool instead of relying on the superseded any-pool rule.

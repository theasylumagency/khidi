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

### R3 — fulfillment

The public facade confirms COD/PICKUP at RESERVE and CARD/BANK at COMMIT with an identical
fulfillment payload in both modes. Simplified completion atomically commits, picks and
hands over each frozen component; AUTO_ASSUMED records the real trigger and executor.
Controlled fulfillment uses genuine per-unit scans/manual proofs, assigned PICK records,
whole-order handover, cancellation with staged returns and ADMIN-only staging loss. PICK
transport/UI remain disabled. After handover no further order stock mutations are allowed;
new migration 0041 also protects closed orders and ledger/snapshot dimensions.

Focused fulfillment, primitive and principal checks: 46 passed. All four payment methods
produce identical completed balances in both modes; bundles auto-complete for all four.
Concurrent/replayed confirmation, manual permissions, wrong scans, partial cancellation,
lost units, same-transaction proof reuse and later proof reuse are covered.

### R4 — durable timeouts

Every new/extended deadline writes an expiry intent and transactional outbox event. The
existing migrator-only media:jobs:deploy command also deploys the reservation queue and
dead-letter queue; hub_app only uses deployed queues. Dispatch inserts the pg-boss job
and acknowledges its consumer in the same transaction. Retries serialize on the header;
old deadlines become stale, commitments never expire, and staging becomes ACTION_REQUIRED
without releasing any component. Pending cancellation survives that attention state.
The worker records the real expiry job, retries failures with backoff and notifies on
dead-letter. Migration 0042 freezes job identity/deadline and final processing.

Six focused timeout tests passed, including duplicate execution, both outcomes of the
confirmation/expiry race, staged cancellation, principal allowlists and real pg-boss
transaction rollback/replay on the isolated test database. Fulfillment/worker typecheck passed.

### R5 — independent workflow model and final acceptance

The existing lower-level inventory model remains intact. A companion unit oracle at the
fulfillment layer extends coverage to reserve, extend, expire, commit, pick, return,
handover, cancel, release, staging loss and composed bundles in both modes. It imports
no production movement matrix and counts independently tracked units. Every generated
command compares balances, immutable snapshots, header/request states and fulfillment
counters; rejected commands must leave stock and ledger unchanged. Programs run inside
rollback-only transactions with a printed replay seed.

Review-driven regressions also cover a valid foreign storefront key, both directions of
a mode switch, component-definition/listing/mapping/price changes after RESERVE, terminal
DB/engine guards, UNIT_LOST webhook provenance, expired PICK-task closure and additional
real staging losses during a pending cancellation. Reservation release is RESERVED-only
so release-versus-commit has one winner; committed orders use fulfillment cancellation.
The new M9 SQL files are pinned to LF without changing any pre-M9 migration bytes.

The long model run passed **1000 programs**, seed **20261109**, in 1368.99 seconds.
Replay with INVENTORY_PROPERTY_RUNS=1000 and INVENTORY_PROPERTY_SEED=20261109, running
only packages/fulfillment/src/property.test.ts. The original inventory model also passes
its 25-program default with this seed. All database runs use isolated loopback `_test`
databases, filesystem media and synthetic fixtures; no shared server is used.

The first full run revealed two legacy primitive fixtures that left an open fulfillment
after releasing all held units. The fixture adapter now closes that work, and the lock
race prepares genuine FK rows before taking balance locks. Their 39 focused checks pass;
no existing assertion or production drain guard was weakened. Final full-suite acceptance
ran from zero public tables in khidi_m9_final_test on isolated PostgreSQL 18.4:
**515 passed, 1 optional S3/MinIO integration test skipped** (89 files passed, 1 skipped),
393.02 seconds. The long run used khidi_m9_work_test. All final typecheck, lint,
dependency-boundary and production-build checks passed. Build used temporary synthetic
configuration and no deployment or storage calls; no production environment was changed.

## Review boundary and follow-up

Phase 1 stops here for enhanced owner review. No storefront transport, key-management
endpoints, webhook delivery, OpenAPI, admin fulfillment screens or PICK/manual UI are
added. Phase 2 must document the same confirmation payload in both modes and require
storefronts to handle REQUESTED or HANDED_OVER/AUTO_ASSUMED without reading the mode.
Partial fulfillment and consolidation require a future ADR; no ledger rewrite is needed.
No new business ADR is proposed. Existing human deployment/restore/device gates stay pending.

## Phase 2 — owner approval and USER COMMIT hardening

The owner approved Phase 1 and authorized R6, R7, R9 and R10; R8 stays deferred.
Before Phase 2, USER COMMIT is limited to a controlled COD/PICKUP reservation and the
immediately matching HANDOVER_OUT in the same command. CARD/BANK commitments remain
storefront/system operations. Focused principal and fulfillment checks: 24 passed.

### R6 — API v1

Dedicated host guards cover proxy, routes and page authentication. Strict Zod contracts,
opaque public projections, atomic idempotent order commands, scoped hashed keys, rotation,
expiry, verified-proxy IP allowlists and PostgreSQL per-key rate windows are implemented.
OpenAPI is generated from the request schemas (`ops/storefront-openapi.ts`). The optional
fulfillment create call returns the complete request already created by confirmation.
It never creates a second request. Raw credentials are returned once, never persisted in
idempotency receipts. See `docs/ops/storefront-api.md` for proxy setup and client semantics.
Focused API/host/key checks: 7 passed; auth/architecture compatibility checks: 12 passed.
Targeted typecheck and dependency boundaries passed. No deployment or proxy changes made.

### R7 — durable signed webhooks

Per-consumer leases, immutable public message bytes and append-only attempt logs support
at-least-once delivery with timestamped HMAC-SHA256, exponential backoff, dead letters
and audited ADMIN retry. Catalog fan-out includes bundles and publication withdrawals;
raw internal event payloads are never sent. Endpoint secrets are encrypted and returned
once. Worker polling is wired beside the existing durable job dispatchers.
Focused tests: 4 passed (signature/tamper/staleness, AUTO_ASSUMED, privacy, concurrent
dispatch, backoff/dead-letter/retry, independent consumers and immutable bodies).
Publishing, worker and Hub typechecks passed. Migration 0044 is new; no applied migration
was edited. Operations and locking documents describe the delivery contract.

### R9 — fulfillment office

ADMIN/ORDER_MANAGER have request list/detail, ACTION_REQUIRED and pending-return filters,
reservation deadlines, per-unit and status histories with actual executor/trigger and
SCAN/MANUAL/AUTO_ASSUMED provenance. ADMIN alone manages the mode, service keys and
webhooks, including dead-letter retry. Key/webhook secrets require recent strong
authentication and are displayed once. Mode changes are audited and affect new orders.
Controlled cancel/loss actions are gated in both UI and domain on the current mode and
the reservation's frozen mode. Cancellation never returns staged units implicitly;
ADMIN can resolve a staged loss even after cancellation. Closed handed-over requests
have no stock action. Warehouse PICK/manual-confirmation/return capture UI stays deferred
under R8/ADR-014. All new UI labels are Georgian translations.
Focused office/behavior tests: 3 passed; architecture authorization checks: 5 passed.

### R10 — local storefront client and acceptance

The loopback-only client executes CARD reserve → payment confirmation → fulfillment
get/ensure and checks idempotent reserve/commit replay. A real HTTP receiver verifies
the timestamped signature and AUTO_ASSUMED. Automated checks additionally cover scope,
host denial, missing idempotency keys, rotation/revocation and HTTP 429. An independent
local Next.js 16.4.3 development server on 127.0.0.1:3123 passed the same flow, receiving
four signed fulfillment events; login was refused on the API host. No real storefront
or shared server was used. `ops/storefront-local-smoke.ts` documents and enforces its
loopback/test-database scope; it never reads `.env` or prints credentials.

Final review added an explicit two-storefront independent-delivery regression, catalog
delta coverage for listing/media records, PostgreSQL-clock scheduling (avoiding a
host/database clock race), per-consumer worker isolation and poison-message dead letters.
No new business ADR or unresolved business decision. R8 remains deferred, and no merge,
deployment, partial shipment or reservation consolidation is included.

Final acceptance ran the full suite **once**, from zero public tables in the isolated
PostgreSQL 18.4 database `khidi_m9p2_final_test`: **536 passed, 1 optional S3/MinIO test
skipped** (96 files passed, 1 skipped), 513.43 seconds. Both independent models passed
their default 25 programs (inventory seed -232060060; fulfillment seed -1332414667).
The previous Phase 1 1000-program stress run remains recorded above.
Typecheck, lint, dependency boundaries and the final production build passed. A native
Node 24 hostname-lookup regression exposed address-family callback handling during final
review; the corrected transport passes the hostname/redirect regression, the focused
webhook tests and final build. No full-suite rerun was needed.

New Phase 2 migrations are 0043 and 0044 only. Phase 2 uses existing pinned Zod and
workspace modules; no external dependency version was added or upgraded. The create
fulfillment endpoint is deliberately an ensure/read of the complete request created
by order confirmation, respecting the owner's atomic-call and one-request rules.
Documents changed in this phase: this record, `docs/ops/storefront-api.md`,
`docs/architecture/locking.md`, and the milestone status/current-task text in `AGENTS.md`.
There are no unresolved business decisions. Keep PR #16 in draft and stop for enhanced
owner review before M10; no deployment or merge performed.

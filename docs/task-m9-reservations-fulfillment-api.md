# Khidi — Milestone 9: Reservations, Fulfillment & Storefront API v1

Repository: `theasylumagency/khidi`

Second milestone that requires an enhanced human review. Built in **two phases** on branch
`m9-reservations-fulfillment` from the latest `main` (after PR #15). One commit per step. Never
commit to `main`.

- **Phase 1:** reservation and fulfillment domain, timeouts, bundles, accounting snapshot, model
  test. Open a **Draft PR** and **stop** for review.
- **Phase 2** (after approval): storefront API v1, service keys, webhooks/outbox worker, OpenAPI,
  admin fulfillment views. The warehouse picking UI is deferred (ADR-014).

## 1. Read first

- `AGENTS.md`
- Implementation Plan v1.1, **Milestone 9** — its scope and verification list are part of this
  task.
- Corrections v1.1: **C1, C4, C5, C10, C14, C15, C16, C18**
- Specification v1.2: §10.7 (reservation policies), §11 (fulfillment requests), §12
  (storefront API, outbox, media delivery), §16.3 (concealment), §16.4 (no customer data)
- ADR-005, ADR-010, ADR-012, **ADR-013** (declared availability, availability pool)
- `docs/milestones/m8-inventory-core.md`, `docs/architecture/locking.md`

### Existing components — extend, do not rebuild

- Ledger primitives for all 15 movement types with preconditions, including `RESERVE`,
  `RESERVATION_RELEASE`, `COMMIT`, `COMMIT_RELEASE`, `PICK_TO_STAGING`, `RETURN_TO_SHELF`,
  `HANDOVER_OUT` and the staging `ADJUSTMENT` variants; line-level accounting per
  `reservation_id`; `payment_method` on ledger rows; nullable `reservation_id`,
  `fulfillment_request_id`, `scan_confirmed` and C18 snapshot columns.
- Workflow proof hooks in `packages/inventory/src/engine.ts`: `assertScanConfirmedReturn`,
  `cancelLostFulfillmentLine` (and `assertApprovedCountLine`, unused while counts are disabled).
- `storefront_api_keys` (hashed key, prefix, allowed IPs, expiry, revocation), `outbox_events`,
  `outbox_deliveries` (per consumer), `webhook_deliveries`, `idempotency_keys` — migration 0001.
- `PICK` task type exists but is disabled (`packages/scanning/src/tasks.ts`).
- Publish-ready / sellable evaluation and storefront projections (`packages/publishing`).
- Mobile camera shell (warehouse scanner), locking helper, model-based inventory property test.

Before writing code, add a short gap inventory to `docs/milestones/m9-reservations-fulfillment.md`.

## 2. Decisions already made

1. **Which allocation a reservation uses.** A reservation for a SKU on a storefront always draws
   from that storefront's allocation in its configured availability pool (ADR-013). Allocations
   in other pools are not used by the reservation engine.
2. **Reservation policies** (spec §10.7), timeouts configurable per storefront:
   `CARD` reserve on payment initiation, 30 min, commit on payment success;
   `BANK_INSTALLMENT` reserve on application, 72 h, commit on approval + order confirmation;
   `PAY_ON_PICKUP` / `CASH_ON_DELIVERY` reserve on order confirmation, 72 h, commit together with
   `HANDOVER_OUT` (C4). Extending a reservation is an explicit API call. Commitments never time
   out.
3. **COD/pickup handover point = handing the goods to the courier, or to the customer for
   pickup** (open decision #7, now decided). A refused or failed delivery afterwards is outside
   the Hub (C1).
4. **Timeouts** run as pg-boss jobs. An expiry never releases a line that is in staging; the
   request moves to `ACTION_REQUIRED` instead (C4).
5. **Sellability is checked only at RESERVE** (C18). Later listing, mapping or price changes do not
   affect existing reservations or commitments.
6. **Accounting snapshot: frozen at RESERVE, written at COMMIT** (C18). Add a primary flag to
   accounting mappings (new migration): at most one active primary mapping per SKU and legal
   entity; when an entity has several active mappings for a SKU, sellability requires a primary
   one. **At RESERVE** each reservation line stores the identity and data of the seller and owner
   mappings in force (id, accounting item id, name). **At COMMIT** the ledger snapshot is written
   from that frozen reservation data, never from the current mapping. A mapping changed or
   disabled after RESERVE never affects that reservation (consistent with decision 5).
7. **Bundles** (C15). A **composed bundle** is a virtual product: it has its own listing, price,
   content and images, but **no allocation, no stock and no accounting mapping of its own**. Its
   sellability requires, for every component: READY and not archived, an allocation in the
   storefront's availability pool, and seller and owner accounting mappings. A component needs
   **no** public listing and **no** price of its own to take part in a bundle. Bundle availability
   = minimum over components of `floor(component available / quantity)`. The storefront reserves
   the bundle SKU; the Hub expands it into component lines at RESERVE and stores the snapshot; all
   components are reserved, committed, picked, handed over and released atomically from that
   snapshot. Accounting snapshots are written per component line. A **factory kit** stays an
   ordinary SKU with its own stock and is never expanded. Fix `packages/publishing`, which today
   requires a bundle's own allocation.
8. **Unit confirmation, scan or manual.** Every unit picked (`PICK_TO_STAGING`) and every unit
   returned (`RETURN_TO_SHELF`) needs a **unit confirmation** recorded by the fulfillment service in
   the same transaction: `SCAN` (the scanned identifier resolves to the line's SKU; a wrong SKU is
   rejected immediately) or `MANUAL`. Every SKU has a system `INTERNAL_QR`, but that does not mean
   the physical unit carries a label; so `MANUAL` is allowed **for a specific unit whose label is
   missing or unreadable**, only by ORDER_MANAGER or ADMIN, with a mandatory reason. A warehouse
   user can request a manual confirmation but never perform it. Manual confirmations are audited
   and visible in the fulfillment record. The ledger engine's protection is **not** weakened:
   replace the `scanConfirmed` boolean requirement with a proof hook that verifies a unit
   confirmation record (scan or manual) exists for that movement in the same transaction; the
   ledger row keeps `scan_confirmed` true only for scans and references the confirmation id.
9. **No customer data.** Fulfillment request and reservation payloads use strict schemas: unknown
   fields are rejected, and no names, phones, addresses or emails are accepted or stored
   (spec §11.4). The storefront order reference is an opaque string.
10. **Concealment and host isolation.** The storefront API is served only on the API host
    (`api.khidi.app` in production), server-to-server, without CORS. Absence of CORS is not
    isolation: API routes answer only when the request's host is the configured API host, admin
    routes and pages refuse on the API host, and the reverse-proxy configuration in `docs/ops/`
    separates the two hosts. No response contains Hub hostnames, internal `KH-` codes, evidence,
    supplier or accounting data.
11. **Who acts on the ledger.** Movements are never executed in the name of a fictitious ADMIN.
    Split the engine's authorization into two entry points:
    - the existing **staff entry point** for manual stock operations, with today's role checks;
    - a **workflow entry point** that only the reservation and fulfillment modules can call (not
      exported from the package index; enforced by a dependency-cruiser rule). The workflow
      module authorizes its principal itself and passes it on; the engine checks the movement
      type against that principal's allowlist.
    Principals: `STOREFRONT_SERVICE` (from an API key; only its own storefront's allocations;
    `RESERVE`, `RESERVATION_RELEASE`, `COMMIT`, `COMMIT_RELEASE`), `USER` (the real user:
    WAREHOUSE assigned to the PICK task for picking, return and handover; ORDER_MANAGER/ADMIN for
    cancellations, manual confirmations and "Lost in staging", which stays ADMIN only), and
    `SYSTEM_JOB` (timeouts; `RESERVATION_RELEASE` of expired lines only). Ledger rows and audit
    record the actual principal type and id (user, API key, or job); add nullable actor columns
    by migration as needed.
12. **Expiry versus payment success.** The reservation row is the single point of decision:
    expiry and commit both lock it (`FOR UPDATE`) and check its state, so exactly one wins. A
    commit arriving after expiry fails with an explicit `RESERVATION_EXPIRED` result (HTTP 409)
    and never commits stock that was already released; the storefront must refund or create a
    new reservation. The same applies to release-versus-commit races.
13. **Order reference format.** The storefront order reference is limited to 1–64 characters of
    `A–Z a–z 0–9 . _ -`, starting with a letter or digit; no `@`, no whitespace, and not
    digits-only longer than 8 characters (storefronts prefix numeric order numbers, e.g.
    `A-123456789`), so that it cannot silently carry an email address or phone number.
14. **Fulfillment modes (ADR-014, read it fully).** The fulfillment mode is a Hub-wide setting
    (system setting `fulfillment_mode`, default `SIMPLIFIED_FULFILLMENT`), changed only by a Hub
    ADMIN and audited; it is not a storefront property, and storefronts can neither read nor
    change it. The mode is frozen on each reservation. In simplified mode the storefront
    confirmation (decision 2) triggers automatic completion of all remaining steps in one atomic,
    idempotent transaction, executed by the principal `SYSTEM_WORKFLOW` (allowlist `COMMIT`,
    `PICK_TO_STAGING`, `HANDOVER_OUT`), recording both the trigger (API key) and the executor;
    confirmations are `AUTO_ASSUMED`, which satisfies the unit-confirmation proof (decision 8)
    only for reservations frozen in simplified mode. For COD/pickup in simplified mode the
    handover happens at order acceptance (this overrides decision 3 for that mode only). Decisions
    3 and 8 apply in full to controlled mode, which stays implemented and tested in the domain.

## 3. Phase 1 — domain (stop for review afterwards)

**R1 — Schema and principals.** Decide and implement decision 11 first. Reservations,
reservation lines (with bundle parent, snapshot and frozen accounting data), unit confirmations,
fulfillment
requests and lines (`picked_quantity`, `returned_quantity`, status per spec §11.2 plus
`ACTION_REQUIRED`), the accounting-mapping primary flag. New migrations; append-only where
history must not change; no DELETE for `hub_app`.

**R2 — Reservation engine** in `packages/inventory` (or a new `packages/reservations` if
boundaries are cleaner): reserve, extend, commit, release, with policies per decision 2, all
through the ledger engine, the locking helper, idempotency and audit/outbox. Sellability at
RESERVE (decision 5); bundle expansion (decision 7); accounting snapshot at COMMIT (decision 6).

**R3 — Fulfillment domain** in `packages/fulfillment`: create from committed lines (or confirmed
COD/pickup lines), pick (`PICK_TO_STAGING`), handover (`HANDOVER_OUT`; COD/pickup with `COMMIT` in
the same transaction), cancel with the per-unit rule (C16: staged units require
`RETURN_TO_SHELF` confirmation, unpicked units are released immediately), "Lost in staging" (C14,
admin only, through `cancelLostFulfillmentLine`). After `HANDED_OVER`, no API or UI action changes
stock for that line (C1). Implement the proof hooks per decision 8.

**R4 — Timeouts** per decision 4 (pg-boss), idempotent and safe to replay.

**R5 — Model test.** Extend the existing model-based inventory property test with reservation
and fulfillment operations (reserve, extend, expire, commit, pick, return, handover, cancel,
lost in staging, bundles), keeping valid/invalid generation. Default run count as today; run once
with 1000 runs and report the seed.

**Phase 1 tests:** the Milestone 9 verification list in the plan, plus: reservation uses only the
availability-pool allocation; composed bundle sellable without its own allocation, blocked when a
component lacks allocation or mappings, not blocked by a component without listing or price;
bundle availability formula; bundle atomicity after the bundle definition changes; factory kit
not expanded; multiple mappings without a primary block sellability; mapping changed after
RESERVE does not change the snapshot written at COMMIT; manual unit confirmation allowed only for
ORDER_MANAGER/ADMIN with a reason, rejected for WAREHOUSE; `RETURN_TO_SHELF` and
`PICK_TO_STAGING` rejected without a confirmation record; each principal type limited to its
movement allowlist and its own storefront; ledger and audit record the real principal; commit and
expiry racing on the same reservation — exactly one wins, late commit returns
`RESERVATION_EXPIRED`; order references that look like an email or phone number are rejected;
payloads with personal-data fields rejected; all ADR-014 acceptance tests (both modes give
identical final balances, automatic progression per payment method and for bundles, failure and
expiry without fulfillment, replay and concurrency, mode frozen per reservation, storefront keys
cannot read or change the mode, `AUTO_ASSUMED` rejected for controlled reservations, provenance in
webhooks).

**End of Phase 1:** focused tests while working; once at the end: typecheck, lint, boundaries,
build, full suite on a fresh `_test` database. Update the milestone document, open a **Draft PR**,
report, and **stop**.

## 4. Phase 2 — API, delivery and UI (after approval)

**R6 — Storefront API v1** (spec §12.1) on the API host: products, prices, stock, reservations
(create/extend/commit/release), fulfillment requests (create/get/cancel). Service keys scoped to
one storefront, hashed, rotatable, optional IP allowlist, per-key rate limiting; every POST
requires `Idempotency-Key`. A key can never read or act on another storefront's data. Generate the
OpenAPI document from the Zod schemas.

**R7 — Outbox worker and webhooks** (C10): per-consumer delivery from `outbox_deliveries`;
HMAC-SHA256 signature over timestamp + body with a per-storefront secret; exponential backoff,
dead letter, admin retry; events carry an id and a schema version so storefronts can deduplicate.

**R8 — Warehouse picking UI: deferred (ADR-014).** Not built in M9. The `PICK` task type stays
disabled and the manual-confirmation UI is not built until the Hub is switched to controlled
mode. The controlled-mode domain and its tests from Phase 1 remain.

**R9 — Admin and ORDER_MANAGER fulfillment views:** request list and detail with confirmation
provenance (`SCAN`, `MANUAL`, `AUTO_ASSUMED`), `ACTION_REQUIRED` items, reservation expiry
overview, and the Hub fulfillment-mode setting (ADMIN only). Controlled-mode actions (cancellation
with return to shelf, "Lost in staging", manual confirmations) appear only when the Hub is in
controlled mode.

**R10 — Test storefront client:** a small script or test fixture that exercises the full API flow
(reserve → commit → fulfillment → webhooks) against a local Hub. No real storefront is built.

**Phase 2 tests:** key scoping and cross-storefront denial; API unreachable on the admin host and
admin pages unreachable on the API host; idempotent POST replay; rate limit;
webhook signature verification and retry/dead-letter; API responses contain no internal or
personal data; end-to-end flow through the test client in simplified mode (reserve → payment
confirmation → automatic completion → webhooks with `AUTO_ASSUMED`).

**End of Phase 2:** same verification as Phase 1; update the milestone document and `AGENTS.md`;
keep the PR in draft until the owner asks.

## 5. Rules for both phases

New migrations only. Never touch the shared database. No deployment. List business questions in
the PR instead of deciding them.

# Khidi — Milestone 10: Movement Reports, Notifications & Audit History

Repository: `theasylumagency/khidi`

Start on branch `m10-reports-notifications` from the latest `main`, **after PR #16 (M9) is
merged**. Single phase. One commit per step. Draft PR at the end; do not merge or deploy.

## 1. Read first

- `AGENTS.md`
- Implementation Plan v1.1, Milestone 10 (its verification list is part of this task)
- Specification v1.2 §10.10 (reports), §14 (notifications), §16.1 (audit)
- Corrections C1 (no returns), C10 (per-consumer outbox), C18 (accounting snapshot)
- ADR-013 (declared availability), ADR-014 (fulfillment modes, `AUTO_ASSUMED`)
- `docs/milestones/m8-inventory-core.md`, `docs/milestones/m9-reservations-fulfillment.md`

### Existing components — extend, do not rebuild

- `packages/notifications` and `packages/reports` contain only constants
  (`NOTIFICATION_LEVELS`, `REPORT_FORMATS`).
- **Producers already exist:** several modules write outbox events with the `notifications`
  consumer (AI jobs, photo retakes, content review, merge conflicts, inventory status, and
  others). Their `outbox_deliveries` rows are pending because no consumer exists yet. Find all
  of them before designing the consumer.
- `inventory_notifications` (append-only, recipients array, no read state) and
  `replenishment_requests` (migration 0035).
- `stock_ledger` with C18 snapshot columns, provenance (`AUTO_ASSUMED`, `SCAN`, `MANUAL`), actor
  columns, relationship mode; reservations with storefront-reported final unit prices.
- `audit_logs` (append-only), Hub pages `/notifications` and `/history` (check their current
  state), VAPID keys in `.env.example` (development keys from M1), the pg-boss worker.

Before writing code, add a short gap inventory to `docs/milestones/m10-reports-notifications.md`.

## 2. Decisions already made

1. **One notification model.** A `notifications` table (event, level, title key and parameters
   for i18n, deep link, entity reference, legal entity scope) and a per-recipient
   `notification_receipts` table (read/unread, muted). Notifications are created only by the
   `notifications` outbox consumer, so every producer stays transactional. Migrate the meaning
   of `inventory_notifications` into this model going forward; keep the old table as history.
2. **Events and levels** (spec §14.1, adapted to ADR-013 and ADR-014). Implement every event
   that existing producers already emit, plus at least: `PRODUCT_REVIEW_REQUIRED`,
   `IDENTIFICATION_FAILED`, `CONTENT_REVIEW_REQUIRED`, `PHOTO_RETAKE_REQUIRED`,
   `MERGE_EVIDENCE_CONFLICT`, `STOCK_LOW`, `STOCK_OUT`, `REPLENISHMENT_REQUESTED`,
   `RESERVATION_ACTION_REQUIRED` (staged expiry and other `ACTION_REQUIRED` fulfillment states),
   `JOB_FAILED` (dead letter), `WEBHOOK_DEAD_LETTER`, `DAILY_REPORT_READY`. Events that exist only
   for disabled features (physical counts, controlled-mode picking) are emitted only when those
   features are active. Map each event to a level (`INFO`, `ACTION_REQUIRED`, `CRITICAL`) and to
   recipients by role, permission and legal entity; document the mapping table in the milestone
   doc.
3. **Recipients are scoped.** A STOCK_MANAGER only receives notifications for its own legal
   entity. WAREHOUSE users receive only notifications about their own tasks. No notification,
   title or deep link reveals data a recipient could not open in the Hub.
4. **No repetition.** One notification per state transition (as M8 minimum stock); repeated
   identical events for an unchanged state are deduplicated by a key.
5. **Muting.** Users may mute `INFO` per event type. `ACTION_REQUIRED` and `CRITICAL` cannot be
   muted.
6. **Web Push.** Use the `web-push` library (exact version, at least two weeks old). Push
   subscriptions per user and device, removed on logout, on device revocation and on
   `404/410` from the push service. Push is sent for `ACTION_REQUIRED` and `CRITICAL` only, and
   for `INFO` only if the user opted in. Payloads contain a title, a short body and a deep link —
   never prices, quantities of money, customer data or evidence details (spec §14.2). Production
   VAPID keys are new keys from the environment; the development keys in `.env.example` must be
   refused in production, like other development secrets.
7. **Reports per legal entity** (spec §10.10, C18, C1). CSV (UTF-8 with BOM) and XLSX, Georgian
   column headers, date range, three views:
   - **As seller:** sales of the entity's storefronts — sale date (`COMMIT`), physical exit date
     (`HANDOVER_OUT`), storefront, storefront order reference, SKU, quantity, final unit price
     reported by the storefront, `vat_included`, the **seller accounting snapshot** from the
     ledger, fulfillment provenance (`AUTO_ASSUMED`, `SCAN`, `MANUAL`).
   - **As owner:** units that left the entity's stock, including units sold by the other entity
     under CONSIGNMENT, with the **owner accounting snapshot**.
   - **Transfers:** cross-entity transfers with document references, from both sides.
   Plus totals per storefront. No returns section (C1). Reports read snapshots only, never the
   current mapping. Availability declarations (ADR-013 `STOCK_IN`/`STOCK_OUT` with reason
   "availability set") are not sales and appear only in a separate optional sheet
   "availability changes".
8. **Bundles in reports.** A composed bundle appears as one priced bundle line followed by its
   component lines with their accounting snapshots and no price. Splitting the bundle price
   across components is open decision #8; do not invent a split.
9. **Daily report delivery.** A scheduled pg-boss job generates the previous day's report per
   legal entity and stores it in private storage; recipients get `DAILY_REPORT_READY` with a
   download link. **No email in this milestone.** Files are private, served through signed
   short-lived URLs, and never contain customer data.
10. **Who sees reports.** ADMIN: all entities. A new granular permission `reports.view`, granted per
    user, allows viewing and downloading reports of the user's own legal entities (for the
    entities' accountants). WAREHOUSE never.
11. **Audit history screen.** ADMIN only: filter by date, actor (user, API key, job, workflow
    policy), entity type, legal entity and action; show before/after, reason and correlation id;
    pagination. A STOCK_MANAGER sees inventory history (ledger view) for its own entity only.
    Never display secrets, password or TOTP data, raw API keys or webhook secrets.

## 3. Steps

**N1 — Notification model and consumer** (decisions 1–5): schema, outbox consumer with
idempotent processing, dedup keys, recipient resolution, in-app notification center (unread
counter, list, deep links, mark read, mute settings).

**N2 — Web Push** (decision 6): subscription management in the PWA, sender in the worker,
cleanup on errors, production key guard.

**N3 — Reports** (decisions 7, 8, 10): domain queries in `packages/reports`, CSV and XLSX export
(add one XLSX library, exact version, at least two weeks old), report screen with entity and date
range.

**N4 — Daily reports** (decision 9).

**N5 — Audit history** (decision 11).

## 4. Tests

- the plan's M10 verification list: report totals equal ledger totals for the period; a
  mapping changed after `COMMIT` still shows the snapshot;
- seller and owner views correct for own-entity and CONSIGNMENT sales; transfers appear on both
  sides; no returns section; availability declarations never appear as sales;
- `AUTO_ASSUMED` provenance shown; bundle line priced, components unpriced with snapshots;
- every existing producer's event becomes exactly one notification per transition; replayed
  outbox delivery creates no duplicate;
- recipients: STOCK_MANAGER of the other entity receives nothing; WAREHOUSE only own tasks;
- muting: `INFO` mutable, `ACTION_REQUIRED`/`CRITICAL` not;
- push payload contains no money, customer or evidence data; `410` removes the subscription;
  development VAPID keys refused in production;
- `reports.view` limited to own entities; WAREHOUSE denied;
- daily report job idempotent per entity and day; download URL expires;
- audit screen hides secrets; STOCK_MANAGER sees only own-entity ledger history.

## 5. Verification and delivery

Focused tests while working; once at the end: typecheck, lint, boundaries, build and the full
suite on a fresh `_test` database. New migrations only; never touch the shared database; no
deployment. Update the milestone document and `AGENTS.md`, open a **Draft PR**, report the PR
link, head SHA, changed files, test results, gaps and any business decisions needing approval.

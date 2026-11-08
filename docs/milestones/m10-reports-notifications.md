# M10 — Reports, notifications and audit

## Gap inventory (before implementation)

Base: latest main `3e6ba5c`, after merged/owner-reviewed PR #16. Branch:
`m10-reports-notifications`. The root worktree's owner changes remain untouched.
The owner task is recorded in `docs/task-m10-reports-notifications-audit.md`.

| Area | Existing implementation | M10 work |
| --- | --- | --- |
| Notifications | Constants only; transactional producer deliveries remain pending. The current page rebuilds a few work lists and reads legacy inventory alerts. | One immutable notification model, recipient receipts/preferences, transition deduplication, scoped center and unread count. Preserve legacy alert rows as history. |
| Producers | Product lifecycle/review, content facts, merge uncertainty, intake/labels/tasks, photo quality/attention, AI dead letters, stock/replenishment, expiry attention and mode changes. Webhook/media dead-letter state exists without a notification consumer target. | Inventory every source, classify safe titles/links, resolve actual recipients and add missing lifecycle/dead-letter delivery intents. |
| Push | Development VAPID example keys and PWA shell; no subscription/sender. | Device/user/session-bound subscriptions, explicit opt-in, safe payloads, durable delivery and cleanup on logout/revocation/404/410; production key guard. |
| Reports | Constants only; immutable ledger/accounting/cart snapshots and provenance exist. | Entity-authorized seller/owner/transfer views, unpriced bundle components, CSV BOM/XLSX, separate optional availability changes and totals. Never read current accounting mappings. |
| Daily reports | No schedule/artifact model. Private write-once media storage and pg-boss are available. | Idempotent previous-Tbilisi-day artifacts per entity, private signed downloads and notification events; no email. |
| Audit | Append-only records; placeholder exposes recent after JSON to broad roles without filters/redaction. | ADMIN-filtered/paginated audit with secret redaction; own-entity ledger history for STOCK_MANAGER. |

## Owner-confirmed report and deadline rules

1. Seller periods use COMMIT; owner periods use HANDOVER_OUT. A later pre-handover
   COMMIT_RELEASE is a separate correction on its own day using the original accounting
   snapshot. Prior daily output stays immutable; this is not a post-handover return.
   Owner-approved bundle exception: a controlled composed bundle has one full-price
   correction on the first FULFILLMENT_CANCELLED decision date (only if committed).
   Component COMMIT_RELEASE rows remain unpriced quantity corrections on their actual
   dates, including later returns from staging. The correction uses original COMMIT
   component accounting snapshots and never allocates the bundle price between them.
2. The owner clarified that M9's one availability pool also means one owner per bundle.
   Enforce it with a domain check/test. Normally the full bundle price contributes to the
   owner's total, with unpriced component snapshots. Mixed-owner defensive reporting
   shows the full header price only as information, excludes it from owner monetary
   totals and marks allocation undetermined; only a future ADR relaxing the invariant
   could make that path reachable. Open decision #8 remains unresolved; invent no split.
3. BANK_INSTALLMENT reminders default to 24 hours, configured Hub-wide by ADMIN. Only
   uncommitted reservations; once per expiry timestamp, including immediately at create/
   extend if already within the window. An extension can notify for its new timestamp.
   Only ADMIN/ORDER_MANAGER members of the seller entity receive it; no automatic extension.

## Steps and verification

One commit for each N1–N5. Focused tests during each step; one fresh isolated `_test`
full-suite run at final acceptance, plus typecheck/lint/boundaries/build. New migrations
only (0045 onward), existing pinned modules reused, and only the task-authorized push
and XLSX libraries added at exact versions older than two weeks. Draft PR, no deploy
or merge, then stop.

## N1 — notification sources and access mapping

| Existing producer/event | Notification / level | Recipients and target |
| --- | --- | --- |
| PRODUCT_INTAKE_RECORDED | NEW_PRODUCT_SCANNED or INTAKE_RECORDED / INFO; unresolved Class A → PRODUCT_REVIEW_REQUIRED / ACTION_REQUIRED; unresolved identification → IDENTIFICATION_FAILED / ACTION_REQUIRED | New SKU: ADMIN/OPERATOR product page. Class A and unidentified: ADMIN review/product. Ordinary task scans: current assignees and ADMIN creator. |
| PRODUCT_APPROVED / PRODUCT_ARCHIVED | PRODUCT_UPDATED / INFO | ADMIN/OPERATOR, product page. |
| PRODUCT_REVIEW_REQUIRED (identity) | PRODUCT_REVIEW_REQUIRED / ACTION_REQUIRED | ADMIN/OPERATOR, product page; identification failure is ADMIN-only. |
| PRODUCT_REVIEW_REQUIRED (content) and unapproved canonical versions | CONTENT_REVIEW_REQUIRED / ACTION_REQUIRED | ADMIN/OPERATOR, product page. Approval/resolution resets transition state without a new alert. |
| PRODUCT_REVIEW_REQUIRED (merge conflict / acknowledged unknown) | MERGE_EVIDENCE_CONFLICT / MERGE_UNDETERMINED / ACTION_REQUIRED | ADMIN, product evidence page. Resolutions reset state. |
| SCAN_TASK_CREATED / COMPLETED | INTAKE: INFO; PHOTO_REQUEST: PHOTO_RETAKE_REQUIRED / ACTION_REQUIRED; EVIDENCE_REQUEST: EVIDENCE_REQUESTED / ACTION_REQUIRED; completion: INFO | Current assignees and ADMIN creator; own scanner task only. PICK/PHYSICAL_COUNT assignment notifications are suppressed while their UI/features remain disabled. |
| LABEL_STATUS_CHANGED | LABEL_STATUS_CHANGED / INFO | Task assignees/ADMIN creator, or ADMIN for quick scans. |
| IMAGE_TIER2_CHECKED, PHOTO_ATTENTION_REPORTED, OFFLINE_PHOTO_DISCARDED | PHOTO_RETAKE_REQUIRED / ACTION_REQUIRED | ADMIN product/intake work; a generated PHOTO_REQUEST separately reaches its actual assignee. |
| IMAGE_QUALITY_DISAGREEMENT | PRODUCT_REVIEW_REQUIRED / ACTION_REQUIRED | ADMIN; no automatic rejection or device-quality override. |
| STOCK_LOW / STOCK_OUT / STOCK_RECOVERED | ACTION_REQUIRED / ACTION_REQUIRED / INFO | Owning entity STOCK_MANAGER members and ADMIN, inventory. Current membership/role is rechecked; raw recipient arrays are never trusted. |
| REPLENISHMENT_CHANGED | OPEN: REPLENISHMENT_REQUESTED / ACTION_REQUIRED; later states: REPLENISHMENT_UPDATED / INFO | Owning entity STOCK_MANAGER members and ADMIN, inventory. |
| STOCK_REVIEW_REQUIRED | STOCK_REVIEW_REQUIRED / CRITICAL; expiry dead letter: JOB_FAILED / CRITICAL | ADMIN inventory/fulfillment. |
| AI_JOB_UPDATED / MEDIA_JOB_UPDATED dead letter | JOB_FAILED / CRITICAL | ADMIN AI/media jobs. A subsequent run/generation can alert again. |
| WEBHOOK_DELIVERY_UPDATED dead letter | WEBHOOK_DEAD_LETTER / CRITICAL | ADMIN fulfillment settings. Retry/delivery resets state. |
| Fulfillment ACTION_REQUIRED / controlled request intent | RESERVATION_ACTION_REQUIRED / ACTION_REQUIRED; FULFILLMENT_REQUESTED / ACTION_REQUIRED | ADMIN/ORDER_MANAGER fulfillment view. Never send a warehouse user to the deferred PICK screen. |
| FULFILLMENT_MODE_CHANGED | INFO | ADMIN fulfillment settings. |
| Daily/report and deadline signals (later steps) | DAILY_REPORT_READY / INFO; RESERVATION_EXPIRING / INFO; FULFILLMENT_OVERDUE / CRITICAL | Report-permission/entity recipients; ADMIN/ORDER_MANAGER for deadlines. |

Only the outbox consumer creates notifications. Unknown future notification sources use a
generic ADMIN audit link without copying payloads. Notification metadata is append-only;
per-user read/mute state is separate, and the database refuses muting non-INFO types.
Current role, entity membership, permission and task assignment are rechecked for list,
count and reads, including after revocation. Outbox INSERT positions preserve transition
order under producer locks; transaction-start timestamps are not a causal ordering key.
The legacy inventory table stays read-only history; new stock alerts go through the same
consumer. Producers now also emit resolution/dead-letter intents needed for recurrence.

Initial focused producer/consumer regressions: 22 passed; notification/Hub typechecks and
dependency boundaries passed. Final task-level verification remains pending.

The approved installment rule is implemented in reservation creation/extension and a
worker deadline sweep: once per exact expiry, 24-hour ADMIN-configurable lead, immediate
notice when inside the window, and seller-membership checks even for ADMIN. Committing,
expiry changes or loss of scope makes an obsolete reminder unavailable. Overdue controlled
requests notify the existing ADMIN/ORDER_MANAGER view, never the disabled PICK UI.
Six focused notification/deadline checks and dependency boundaries passed.

## N2 — Web Push

Pinned `web-push` 3.6.7 and types 3.6.4 (publication dates verified from npm) power
encryption/VAPID. Explicit per-device consent and separate INFO opt-in; encrypted registry
capabilities, session/device ownership checks and database cleanup on logout, revocation
and shared-device user switch. The worker uses independent durable push intents, leases,
retry/backoff and append-only attempts. HTTP 404/410 removes subscriptions. Every send
rechecks current recipient access and mute/opt-in state. Generic lock-screen payloads
carry no financial/customer/evidence content. Production refuses development VAPID keys.
Worker/Hub production startup validates the matching key pair. Browser logout unsubscribes
and notification clicks are constrained to the Hub origin.

Focused push/session/service-worker checks: 20 passed; notification and Hub typechecks
passed. No push was sent to a real device. Operations are in
`docs/ops/notifications-reports.md`; private production configuration remains untouched.

## N3 — movement reports

Implemented seller COMMIT / COMMIT_RELEASE corrections and owner HANDOVER_OUT periods in
Asia/Tbilisi, immutable C18 accounting snapshots, final cart prices, separate transfer and
optional availability sections, and exact integer-money storefront totals. A bundle carries
one priced header; its component rows carry quantities and accounting snapshots without a
price split. Reservation planning explicitly refuses mixed-owner bundles. The defensive
mixed-owner report excludes the informational header price from owner totals; this branch
is unreachable under today's one-pool invariant and would require a future ADR to enable.

CSV is UTF-8 BOM with formula-injection protection; XLSX uses exceljs 4.4.0
(published 2023-10-19). A read-only repeatable-read snapshot keeps each export internally
consistent. Preview is bounded; exports refuse oversized periods rather than truncate.
ADMIN can view all entities and grant reports.view to an existing non-warehouse member;
other users require that grant and their own entity membership. Daily recipients are
configured separately per existing membership; granting reports.view is per user.

New migration 0048 snapshots price ID and vat_included at reservation time. Legacy M9
reservations have no recorded VAT snapshot and are explicitly shown as unknown; current
prices or accounting mappings are never used to invent historical values.

Focused verification: initial reports 6/6, reservations 6/6; reports and Hub type checks
passed. The approved staged-bundle cancellation rule adds a seventh report regression:
one money correction on the cancellation day, no duplicate component quantities, later
component releases on their own dates and zero money over the whole order period.
Session-local temporary timestamp fixtures leave the real append-only records unchanged.
Cancellation headers retain original component accounting snapshots without fabricating
a bundle accounting code. Each view's DTO strips the other entity's accounting fields.

## N4 — daily reports

Migration 0049 freezes one report snapshot per entity/Tbilisi day and append-only CSV/XLSX
file references. pg-boss runs at 00:05 Asia/Tbilisi with retry/backoff and a dead-letter
notification. Ready is emitted once only after both private files are recorded; ADMIN
receives a daily notification only when configured as an entity report recipient, like
other authorized recipients. A storage outage can be retried without changing the snapshot.
Five-minute signed links bind the user and recheck current scope before hash-verified reads.
No email. Operations includes manual catch-up for missed days and orphan-object handling.

Focused daily-report tests 2/2 and notification regression tests 5/5 passed, including a
storage outage/retry, unchanged snapshot, single ready event, private file integrity,
cross-user/expired URL rejection and an actual deployed pg-boss Tbilisi cron definition.

## N5 — audit and inventory history

ADMIN gets date, actor kind/ID, object type/ID, legal entity, action and correlation filters,
before/after/reason/document/correlation details, and cursor pagination. Secret redaction
occurs before transport/rendering, including nested auth data, encrypted values, credentials,
bearer/raw-key material and common sensitive free-text patterns. STOCK_MANAGER gets only
its own entities' ledger projection, with no accounting or actor-secret payloads; OPERATOR
and WAREHOUSE cannot open general history.

Migration 0050 backfills a separate append-only legal-entity scope index and maintains it
transactionally by an audit INSERT trigger. Original audit content remains untouched.
Scope comes from the audit's recorded IDs and linked workflow/entity identities, not
current accounting names. Historical missing actor attribution stays unknown; M10's
consumer/push/report worker writes record SYSTEM_JOB attribution going forward.

## Acceptance verification and handoff

- Full suite, once on a fresh isolated PostgreSQL 18.4 database
  `khidi_m10_acceptance_test` (zero public tables before setup): **561 passed, 1 skipped**,
  102 passing files / 1 skipped file. The optional MinIO S3 test was skipped because no
  MinIO endpoint was supplied. Existing authentication, migrations, ledger, reservations,
  fulfillment, idempotency and offline-queue regressions passed.
- Final report review tightened cancellation component quantities and stripped the
  other side's accounting fields from DTOs; the complete affected report package was
  then rerun: **13/13 passed** (reports 7, daily 2, audit 4), including next-day staged
  returns and CONSIGNMENT confidentiality. No second full-suite run.
- Root typecheck, lint (including dependency boundaries), and production build passed.
  After the final report changes, report typecheck/lint and boundaries were rerun.
  The production build was repeated with ephemeral synthetic secrets and local test DB
  configuration; no production service, data, environment or deployment was touched.
- `git diff --check` is clean. Migrations 0045–0050 are new; LF attributes keep their
  checksum bytes stable on Windows/Linux. Existing migrations are unchanged.

No new ADR was needed; the owner-confirmed period rules, single-owner bundle invariant,
controlled-bundle cancellation exception and installment reminder policy are recorded
above. The task document also records the approved bundle cancellation exception.
Open decision #8 (price allocation between bundle components) remains open; no split
was invented. Legacy VAT snapshots remain explicitly unknown.

Owner/device checks before rollout:

- Android and installed iPhone PWA: opt in explicitly, test lock-screen delivery, deep
  links after reauthentication, INFO opt-in/mute, logout and device-revocation cleanup.
  No real push service/device was contacted during automated verification.
- Run the documented queue deployment and verify the 00:05 Tbilisi schedule only when
  the owner deploys M10; download a generated report as ADMIN and an authorized entity
  accountant, then revoke access and confirm the link no longer works.
- Existing backup/restore, thermal-printer and other deployment checks in AGENTS.md are
  still pending. No merge or deployment is authorized by this work.

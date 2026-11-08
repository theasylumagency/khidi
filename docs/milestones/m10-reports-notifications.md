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

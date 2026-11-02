# M3 — Scanning handoff (2026-11-02)

Branch: `m3-scanning`. S1–S5, S7 and S8 are implemented. Android's gateway spike was
confirmed by the owner on 2026-11-02; S6 can now proceed. iPhone checks and the
shared-server backup activation/restore drill remain pre-pilot human checks.

## Delivered

- S1: new migrations `0003_scanning.sql` and `0004_label_event_transition.sql`,
  scan tasks, durable intake keys, duplicate links, append-only label events,
  explicit application-role grants and database invariants.
- S2: transactional/audited/outbox intake processing, GTIN-14 normalization,
  collision review, archived-match exclusion, task duplicate detection, and
  replay safety even after the generic idempotency cache expires.
- S3: provisional no-barcode drafts, a desktop print queue, batch 58 × 40 mm
  labels, explicit print confirmation and attachment by a later internal scan.
  Attachment does not count the provisional intake again.
- S4: admin task creation, assignment, target/due date, progress, Quick Scan and
  intake-history filters. Other task types return their enabling milestone.
- S5: framework-independent IndexedDB queue, per-user ownership, pending/blocked
  counts, backoff, restart/online/focus triggers, session checks between sends and
  server-side owner checks. HTML/API service-worker caching remains disabled.
- S7: pgBackRest full-backup/restore/verification scripts, encrypted local drill,
  production off-server configuration example, nightly timer, retention and runbook.
- S8: Accepted ADR-005. Business exceptions persist as review intakes with no
  catalog changes or progress. Admin-only, noted resolutions can link, accept
  (including explicit reopening and then normal identity processing), or dismiss.
  Blocked technical/security scans can be discarded by their owner after confirmation;
  an atomic IndexedDB discard outbox retains their trace until server audit succeeds.

## Validation

- `corepack pnpm typecheck` and `corepack pnpm check:boundaries`: passed.
- `corepack pnpm test`: 76/76 on a newly created isolated PostgreSQL 18.4 database,
  then 76/76 on the same database again.
- `corepack pnpm --filter @khidi/hub build`: passed.
- Actual encrypted pgBackRest 2.60.0 full backup and clean physical restore:
  migration checksums and all 16 core-table counts matched; 76/76 tests passed on
  the restored copy. This local drill does not verify the future off-server S3
  configuration or replace the human's first shared-deployment restore test.
- Browser: created an admin task; accepted a no-barcode intake while offline;
  observed pending count 1, then automatic delivery/count 0 on reconnect; checked
  the label preview. Actual printer output and real-phone camera/gateway checks
  remain human/device verification.

## Document differences and implementation choices

- AGENTS.md's M3 scope wins over the broader milestone plan: no photos/AI/jobs;
  only `INTAKE_UNIQUE`; S6 now allowed after Android confirmation; shared-server backup configuration remains a
  deployment operation and media versioning/replication is M4.
- `client_device_id` records the client-provided ID; `device_id` retains the
  authenticated registered-device FK. This also supports office Quick Scan from
  a browser without a warehouse registration.
- Intakes add a normalized task identifier, duplicate-of link and persistent
  request hash for concurrency and long-offline replay protection.
- `0004` is a new migration fixing SQL CHECK's nullable-source transition logic;
  no applied migration was edited.
- M2's placeholder QR artwork was replaced with a decodable QR, using the single
  permitted ZXing dependency: `@zxing/library` 0.21.3 (released 2024-08-21).
  The only other new npm library is dev-only `fake-indexeddb` 6.2.4.
- Printing uses a separate authenticated label-only document. Legacy affiliation
  annotations are removed from staff names displayed in the new scanning views.
- Backup scripts use the existing Node/tsx runtime, so the same workflow runs on
  Linux and in a Windows-driven isolated Docker drill without a second shell stack.

## ADRs and open questions

- ADR-004: Accepted technical choice of pgBackRest.
- ADR-005: Accepted by the owner and implemented in S8. Unknown/archived internal
  labels, collisions and stale task assignments/statuses are recorded for review.
  The owner clarified that every Class A intake is catalog-read-only; only an
  admin's later resolution may create the draft for a task exception.
- Task progress counts distinct original intakes, as required. The documents do
  not define automatic task closure at the target versus pending labels/photos;
  no automatic `COMPLETED` transition was introduced. Define this before adding
  task-completion controls.

## Documentation changes

- Updated root AGENTS.md with the owner's M3 instructions and actual partial status.
- Removed the obsolete unversioned corrections document, as the owner requested;
  the restored versioned C1–C18 source remains unchanged.
- Added ADR-004, Proposed ADR-005, `docs/ops/backup-restore.md` and this handoff.
- `apps/hub/AGENTS.md` is the guidance generated by the installed Next.js version
  when running its development server; it points future edits to bundled docs.

## S8 migration and replay details

`0005_intake_review.sql` adds review fields and constraints, a reference-only SKU id
for archived labels, the original review reason, the scanned identifier type and an
immutable acceptance-response snapshot. Accepted task reviews clear the active
`review_reason` while keeping the original reason and resolution, allowing the
same uniqueness rule to protect subsequent scans. Link/dismiss history stays excluded.
Existing collision intakes are backfilled for review and their formerly counted task
progress is recalculated. Migrations 0001–0004 are unchanged.

Replacement labels reuse the intake's print queue via `replacement_label_requested`;
they do not attach the wrong scanned identity to the selected SKU. A new append-only
`intake_review_actions` receipt table preserves review idempotency after cache expiry.
The backup verification table list now includes this seventeenth core table.

IndexedDB v2 preserves v1 scans/device identity and adds a discard-report outbox.
The original queued scan is removed in the same transaction that stores the report.
Reports are sent only with the original owner's session; server auditing is also
idempotent after cache expiry. Reasons and per-entry errors are shown in Georgian.

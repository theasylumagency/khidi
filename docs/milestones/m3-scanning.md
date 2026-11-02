# M3 — Scanning handoff (2026-11-02)

Branch: `m3-scanning`. S1–S8 are implemented, with S8 completed before S6.
Android's gateway spike was confirmed by the owner on 2026-11-02. iPhone checks and the
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
- S6: Georgian mobile scanner, assigned-task list, private progress endpoint,
  manual/no-barcode entry, rear-camera preference, inline muted video, native
  BarcodeDetector and ZXing fallback, capability-based torch and immediate next scan.
  Progress uses server-confirmed distinct intakes; pending scans remain separately visible.

## Validation

- `corepack pnpm typecheck` and `corepack pnpm check:boundaries`: passed.
- `corepack pnpm test`: final 100/100 on a newly created isolated PostgreSQL 18.4
  database (`khidi_m3_release_verify`), then 100/100 on the same database again.
- Coverage includes all Class A reasons/resolutions, durable replay, the v1 → v2
  queue upgrade, owner-only discard reporting/retry, assignment changes, private
  progress reads, native/ZXing selection, partial native-format support, actual QR
  frame decoding, torch, denied permission/retry, late camera startup and track cleanup.
- `corepack pnpm --filter @khidi/hub build`: passed.
- Earlier S7 encrypted pgBackRest 2.60.0 full backup and clean physical restore:
  migration checksums and all 16 core-table counts matched; 76/76 tests passed on
  the restored copy. This local drill does not verify the future off-server S3
  configuration or replace the human's first shared-deployment restore test.
- Earlier S1–S5 browser checks: created an admin task, accepted an offline no-barcode
  intake, observed later delivery and checked the label preview.
- S6 browser check at 390 × 844: accepted a manual code with the network disabled;
  immediate “✓ კოდი მიღებულია” and pending 1; reconnected/retried, pending 0 and
  progress 0/3 → 1/3. An unknown internal label showed the Class A review message,
  stayed out of progress and cleared from the pending queue. No real camera or
  printer hardware was certified by these local checks. Android gateway evidence
  is the owner's §3 confirmation; iPhone still requires the checklist below.
  A warehouse account landed on its assigned-work list; opening `/tasks` redirected
  back to that list without exposing administration. Its review scan also kept progress unchanged.

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
  S6 reuses that exact library in `packages/scanning`; no `@zxing/browser` or
  additional library was needed. The fallback chunk is loaded separately and
  warmed when an iPhone-style scanner without BarcodeDetector opens online.
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

- Updated root AGENTS.md with the owner's M3 instructions, completed implementation,
  shared-deployment/migration freeze and the remaining human pre-pilot checks.
- Removed the obsolete unversioned corrections document, as the owner requested;
  the restored versioned C1–C18 source remains unchanged.
- Added Accepted ADR-004, the owner's corrected Accepted ADR-005,
  `docs/ops/backup-restore.md` and this handoff, including the iPhone checklist.
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

## S6 operation and iPhone pre-pilot checklist

Warehouse sign-in lands on `/warehouse/tasks`, with only active assigned intake work.
`/tasks`, intake history, label administration and review remain ADMIN-only. Admins
can open the scanner from task administration or use `/scanning/quick`. Existing
assignment and intake permissions are unchanged. All new screen text uses `t()`.

Camera frames stay in the browser and are never uploaded or saved as photos. The
controller stops every track on unmount/navigation, `pagehide`, hidden visibility
(including phone lock), or an ended track. Returning requires a deliberate restart.
A stationary visible label is accepted once; remove it for at least 0.8 seconds
before intentionally scanning the same label again. A different code is immediately
eligible. If IndexedDB cannot persist the scan, no success is shown.

BarcodeDetector uses its supported formats; ZXing handles a missing/failed detector
and supplements partial native format support. Requested formats are EAN-8/13,
UPC-A/E, Code128, Code39, QR and DataMatrix. Torch controls appear only when reported
by the live track. The video is muted and `playsinline` for standalone Safari.

The owner must run the following on a **real iPhone behind the gateway** before
using any iPhone for pilot intake. Record device/iOS version, date and results;
update AGENTS.md §3 only after that evidence exists.

- [ ] Open through the gateway in Safari, sign in and install to the Home Screen.
      Confirm the neutral Khidi name/icon and authenticated standalone launch.
- [ ] In standalone mode, allow camera access and confirm rear-camera preview
      stays inline. Deny access once, confirm the Georgian explanation/manual
      entry, then allow and retry. Confirm no unsupported torch button appears.
- [ ] Confirm BarcodeDetector is absent and the ZXing path reads external EAN/UPC,
      Code128/39, internal `KH-` Code128 and `khidi://sku/…` QR; check DataMatrix
      with a physical sample. Check orientation, lighting, immediate next scan,
      and suppression of repeated frames from one stationary label.
- [ ] Leave the screen, switch apps and lock the phone: camera indicator goes off.
      Return and deliberately restart; no hidden scanning or duplicate delivery.
- [ ] Open the task and start the camera while online once (loads/caches decoder
      assets), then disable connectivity **with that screen still open**. Scan
      and use no-barcode/manual entry. Confirm immediate acceptance, visible
      pending count and unchanged confirmed progress. Reconnect and verify delivery
      once, pending zero and correct distinct progress. HTML/API caching remains
      disabled, so a cold offline launch/navigation is not promised.
- [ ] Switch PIN user while scans wait: the previous user's entries remain under
      that name and never send with the new user's session. Return to the owner
      and verify delivery. Check owner-only blocked discard and later server audit.
- [ ] Scan an unknown/archived internal label: confirm the review message and no
      progress/catalog mutation; have an admin complete a noted resolution.
- [ ] Grant notification permission from the installed app and verify push through
      the gateway, including after app backgrounding (ADR-002).

Before **any pilot intake**, also activate encrypted off-server backups and retention
on the shared server and have the human perform/record the first real restore test
(ADR-004, `docs/ops/backup-restore.md`). The local drill does not close this gate.
Check actual 58 × 40 mm printer output before relying on printed labels.

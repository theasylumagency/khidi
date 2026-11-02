# AGENTS.md — Khidi Hub

Instructions for any coding agent (Codex, Claude Code, Gemini) working in this repository.
Read this file completely before changing anything.

## 1. What this is

Khidi is a private internal hub. It is the canonical source for products, SKUs, evidence,
accounting mappings, media, storefront base prices, online stock, reservations and
fulfillment work. Two future public storefronts, run by **two legal entities**, will consume
it through a server-to-server API. Phase 1 builds only the Hub.

**Confidentiality rule.** The Hub must not reveal that both storefronts share one system.
Never put a client or company name in anything a user, customer or outsider can see:
UI strings, manifest, TOTP issuer, email sender, print labels, internal SKU prefixes,
public URLs, image URLs. Use the neutral name "Khidi".

## 2. Sources of truth (in order of precedence)

All in `docs/`:

1. `AgroTrade Hub — Corrections to Implementation Plan v1.1.md` — corrections **C1–C18**.
2. `AgroTrade Hub — Technical Specification v1.2.md` — the specification.
3. `AgroTrade Hub — Implementation Plan v1.1.md` — the milestone plan.
4. `docs/adr/` — accepted ADRs override the plan on their own topic.
5. Section 9 of this file (errata) overrides all of the above where it applies.

**Superseded — do not use:** `AgroTrade Hub — Corrections to Implementation Plan.md`
(the older C1–C13 version without the v1.1 suffix).

If two sources conflict and this list does not resolve it, stop and ask. Do not choose.

## 3. Current status

| Milestone | Status |
| --- | --- |
| M1 Foundation, auth, PWA shell | Done |
| M2 Product model | Done (F1–F7, G1–G2 closed) |
| M3 Scanning, intake, labels, offline queue, backup tooling | **S1–S5 and S7 implemented; S6 gated by the real-device spike — see §10** |
| M4–M11 | Not started |

Real-device gateway spike (ADR-002 checks on a real Android phone and a real iPhone):
**not yet confirmed**. The human owner updates this line.

Shared deployments (any database outside a developer machine): **none yet**.
Record the date here the first time a database is deployed to a shared or staging server;
from that moment §6 "Migration squash window" is closed.

M3 local verification (2026-11-02): typecheck and dependency boundaries passed;
76 tests passed on a fresh isolated PostgreSQL 18.4 database and on its re-run.
A pgBackRest 2.60.0 local encrypted backup was restored into a separate cluster:
migration checksums and 16 core-table row counts matched; all 76 tests passed there.
This is not the first shared-deployment restore test; off-server storage and that
human-run test remain pending. See `docs/milestones/m3-scanning.md` and ADR-004/005.

Update this table at the end of every milestone.

## 4. Setup and commands

Requirements: Node.js 24, Corepack (pnpm version is pinned in `package.json`), Docker.

```bash
corepack enable
corepack pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres          # PostgreSQL 18 on 127.0.0.1:5435, roles via docker/postgres/init-roles.sh
corepack pnpm db:migrate               # runs as hub_migrator
corepack pnpm db:seed
corepack pnpm dev:hub                  # http://localhost:3100
```

Before you report any task as finished, all four must pass:

```bash
corepack pnpm typecheck
corepack pnpm check:boundaries
corepack pnpm test                     # requires the database
corepack pnpm test                     # run twice: tests must pass on a fresh DB and on a re-run
```

Reset a dev database when a migration needs a clean start: drop and recreate the database,
re-run `init-roles.sh`, then migrate and seed. Never "fix" a dev DB by editing applied migrations.

### Running without Docker (e.g. Codex cloud environments)

If Docker is not available, install PostgreSQL in the setup script and provision roles with
the repository script. PostgreSQL 16 or newer is acceptable for running tests; production is 18.

```bash
apt-get update && apt-get install -y postgresql
# start a cluster listening on 127.0.0.1:5435 with superuser hub_migrator
# (password from .env.example), create database agrotrade_hub, then:
POSTGRES_USER=hub_migrator POSTGRES_DB=agrotrade_hub \
HUB_APP_DB_PASSWORD=hub_app_dev_password PGHOST=127.0.0.1 PGPORT=5435 \
sh docker/postgres/init-roles.sh
corepack pnpm test                     # global setup migrates and seeds
```

Network access is only needed during setup (package install). Do not add dependencies at
task time unless the task explicitly allows it (§7).

## 5. Architecture rules

- **Modular monolith.** Business logic lives in `packages/*`. `apps/hub` and `apps/worker`
  are thin: they authenticate, validate input and call domain services.
- **Dependency boundaries** are enforced by `.dependency-cruiser.cjs` and must stay green.
  `packages/publishing` sits on top (sellability, storefront projection). `products` must not
  import `pricing`, `inventory` or `fulfillment`. No cycles.
- **Every state-changing domain operation** runs inside `withDomainTransaction`, writing the
  change, its `audit_logs` row and its outbox event in one transaction.
- **Externally triggered writes** (API, offline replays) go through `executeIdempotent`, and the
  handler uses the `tx` it receives — never the global `db`.
- IDs: `createUuidV7()`. Money: integer minor units (tetri) with currency. Time: stored UTC,
  displayed `Asia/Tbilisi`.
- Storefronts never touch PostgreSQL. They use the versioned API only.

## 6. Database rules

- **Never edit an applied migration.** The runner enforces checksums and will fail.
  Every change is a new numbered file in `packages/db/migrations/` (`0003_…sql`, `0004_…sql`).
- **Migration squash window.** While §3 says "Shared deployments: none yet", an existing
  migration may be rewritten only when the human owner explicitly asks for it in the task.
  Say so in the PR and tell developers to reset their databases. Once any shared database
  exists, the window is closed permanently: new migrations only, no exceptions.
- History: `0002_product_model.sql` was rewritten once during the M2 fixes. Any database
  created before commit `ad4ab42` must be dropped and rebuilt.
- Migrations run as `hub_migrator`. They never create roles or contain passwords; roles are
  provisioned by infrastructure (`docker/postgres/init-roles.sh`).
- Grant `hub_app` only the privileges it needs, explicitly, in the migration that creates the table.
- **Append-only tables** (no UPDATE/DELETE for `hub_app`, trigger + REVOKE): `audit_logs`,
  `outbox_events`, `sku_slug_history`, and later `stock_ledger`, `storefront_prices`.
  Use `enforce_append_only_table()`.
- Domain entities are archived or deactivated, never deleted.
- Constraints that protect invariants belong in the database (CHECK, partial unique indexes),
  not only in TypeScript.

## 7. Security and auth rules

- Every `page.tsx` except `/login` calls `requirePageAuth()`. Every `route.ts` verifies the
  principal and its role. The architecture test enforces this; keep it passing.
- `proxy.ts` is a first filter only. It is never the authorization check.
- No secrets in code. In production the app must fail fast when a required secret is missing
  or equals a development default.
- The Hub never stores customer personal data (names, phones, addresses, emails).
- Do not upgrade, add or remove dependencies unless the task asks for it. Pin exact versions.

## 8. Product and UI rules

- UI language: Georgian, through `t()` from `packages/i18n`. No hard-coded user-facing strings.
  Warehouse screens are Georgian only, large touch targets, short sentences.
- Desktop admin: dense, table-first, keyboard-friendly. Mobile: scanning, tasks, photos.
- AI and automation must never invent specifications, model identity, manufacturers or GTINs.
  Unknown is a valid state (`value: null, status: NOT_FOUND`).
- **Identity confidence (`skus.identity_confidence`).** Until Milestone 5 (`packages/evidence`),
  `identity_confidence` may only be set by an `ADMIN` via the dedicated manual action
  (`setSkuIdentityConfidence` / `POST /api/products/confidence`) with a mandatory non-empty
  `reason` and its own `IDENTITY_CONFIDENCE_SET_MANUALLY` audit log entry — never as a side-effect
  of `transitionSkuLifecycle` or `/api/products/ready`. **Starting in M5 (`packages/evidence`),
  `identity_confidence` must be computed exclusively from evidence and must no longer be accepted
  from client input.**
- Business semantics (stock rules, reservation policies, ownership, pricing boundaries,
  lifecycle states, permissions, AI rules) may not be changed on your own. Write an ADR in
  `docs/adr/` marked **Proposed** and stop that item until it is approved.
  Implementation details (naming, structure, indexes, components) are yours to improve.

## 9. Errata (override the documents above)

- **E1 — Internal SKU format.** Internal SKUs and printed labels never contain a company
  abbreviation. Format `KH-000001`, sequence starting at 1. Applied in M2 (F2); the
  specification has been updated accordingly.
- **E2 — Identity confidence is temporarily manual.** Until M5 builds the evidence-based
  confidence calculator, confidence can only be set by an ADMIN through the dedicated,
  audited action from G1. It must never arrive as an incidental field in another request.
  M5 must replace manual confidence with the computed value and decide in an ADR whether a
  manual override remains at all.

## 10. Current task: Milestone 3

Branch: `m3-scanning`. Never commit to `main`. One commit per step, message prefixed with the
step ID (S1…S7). Each step needs tests. Schema changes go into new migrations (`0003_…`).

**Done before M3:** F1–F7 and G1–G2 (lifecycle, neutral `KH-` SKUs, variant slugs,
field provenance, GTIN-14, test isolation, no DELETE on catalog, audited manual confidence).

### Scope boundaries (read first)

- **No photos in M3.** Guided photo capture and storage are M4. The warehouse flow ends after
  the scan with a "photos pending" state; design the flow so M4 can insert the photo step.
- **Task types:** the schema accepts all five (`INTAKE_UNIQUE`, `PHYSICAL_COUNT`,
  `PHOTO_REQUEST`, `EVIDENCE_REQUEST`, `PICK`), but only **`INTAKE_UNIQUE`** is implemented.
  Creating any other type returns a clear "available from milestone X" error
  (PHYSICAL_COUNT → M8, PICK → M9, PHOTO_REQUEST → M4, EVIDENCE_REQUEST → M5).
  Columns that will reference tables not yet existing (`pool_id`, `fulfillment_request_id`)
  are nullable without foreign keys; M8/M9 add the constraints.
- **No AI, no worker jobs.** Identification stays manual until M5.
- Dependencies: you may add exactly one barcode library (ZXing for the browser, exact pinned
  version at least two weeks old) and `fake-indexeddb` as a dev dependency for tests.

### Steps

**S1 — Schema.** Migration `0003_scanning.sql`: `scan_tasks` and `product_intakes` as in the
plan §2.3, plus `label_events` if you need label history. `product_intakes.idempotency_key`
is unique. Grants for `hub_app` explicit; no DELETE on either table.

**S2 — Intake domain service** (`packages/scanning`), all inside `executeIdempotent` +
`withDomainTransaction`:
- Normalize the scanned value with the M2 identifier functions (GTIN-14, internal labels).
- Exactly one matching SKU → `MATCHED_EXISTING`.
- Several matching SKUs (collision) → `MANUAL_IDENTIFICATION_REQUIRED`, no SKU created.
- No match → create a SKU draft (`INTAKE`, `LOW`) with the scanned identifier attached as
  unverified → `NEW_DRAFT`.
- **Duplicate in an `INTAKE_UNIQUE` task:** a second scan of an identifier already taken in
  the same task records the intake as a duplicate of the first and creates no new SKU.
- Archived SKUs never match.
- The client-supplied `scannedAt` and device id are stored; the server time is stored too.

**S3 — No-barcode flow and labels.**
- "No barcode" creates a provisional SKU draft with an internal SKU immediately and puts the
  intake in `label_status = TO_PRINT`.
- "Labels to print" queue page (desktop): select, print in batch with the existing
  58 × 40 mm template, mark `PRINTED`.
- Attaching is confirmed by scanning the printed label on the product → `ATTACHED`.
  Scanning an internal label resolves directly to its SKU everywhere.

**S4 — Tasks and Admin Quick Scan.**
- Admin creates an `INTAKE_UNIQUE` task (title, assignee user or role, optional Product Type,
  target count, due date); progress = distinct intakes / target.
- Quick Scan: admin scans without a task (`source_mode = QUICK_SCAN`).
- Task and intake lists for admin (desktop, table-first), with filters by result and label status.

**S5 — Offline queue** (client module, framework-independent, unit-tested with `fake-indexeddb`):
- Every scan is first written to IndexedDB with a client UUIDv7 idempotency key, the user id,
  device id and `scannedAt`, then sent. The UI never waits for the server to show "✓ კოდი მიღებულია".
- Visible pending counter; retry with backoff; resume on `online`, on app start and on focus.
  Do not depend on Background Sync.
- **Shared phones:** each entry belongs to the user who scanned it and is sent only with that
  user's session. After a PIN user switch, entries of the previous user stay queued and a
  banner shows how many are waiting for whom. Never re-attribute an entry to another user.
- Entries are removed only after a successful server response or an idempotent replay.
- The service worker still never caches HTML or API responses.

**S6 — Warehouse scanner UI** (mobile, Georgian only, large targets, spec §7.3):
camera scanning with `BarcodeDetector` where available and ZXing fallback; manual entry;
torch toggle where supported; task progress "12 / 27"; immediate next scan.
**Before starting S6, check §3: if the real-device spike is not confirmed, finish S1–S5 and S7,
open the PR, and stop.** The camera and offline behaviour behind the gateway must be proven
first.

**S7 — Backup and restore tooling** (no live server exists yet, so this is tooling + runbook):
- `docs/ops/backup-restore.md`: PostgreSQL WAL archiving with point-in-time recovery,
  nightly full backup, 30-day retention, encrypted off-server storage. Pick one tool
  (pgBackRest or WAL-G) and justify it in an ADR.
- Scripts in `ops/` to take a backup and to restore into a clean database.
- A restore verification script: restore → run migrations check (checksums match) →
  compare row counts of core tables with the source → run the test suite against it.
- Object storage versioning is documented here but configured in M4 with media.
- The first real restore test is performed by the human on the first shared deployment,
  before any pilot intake. Note this in §3 when done.

### Acceptance

- Fresh database: §4 checks pass twice in a row.
- Tests cover: idempotent replay creates no duplicate intake or SKU; duplicate in a unique
  task; collision → manual identification; archived SKU not matched; no-barcode → label queue
  → printed → attached by scan; offline queue per-user behaviour and retry; non-admin cannot
  create tasks; warehouse user cannot see task administration.
- Update §3, open a PR from `m3-scanning` listing deviations, ADRs and `docs/` changes, and stop.

## 11. Working agreement

- **Never commit directly to `main`.** One milestone (or fix list) per branch, merged by PR.
  Small commits. No unrelated refactors.
- At the end of each milestone: run §4 from a fresh database, update §3, and write a short
  summary in the PR listing every deviation from the documents, every ADR created, and every
  change you made to files in `docs/`.
- Milestones 8 and 9 (ledger, reservations, fulfillment) get an extra human review before the
  next milestone starts.
- If something is unclear, list it as an open question in the PR. Do not guess business rules.

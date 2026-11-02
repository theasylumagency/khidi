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
| M3 Scanning, intake, labels, offline queue, backup tooling | Implementation complete (S1–S8). Human pre-pilot checks below remain pending. |
| M4–M11 | Not started |

Real-device gateway spike (ADR-002 checks):
- **Android: confirmed** by the owner on 2026-11-02 (install, service worker, camera,
  IndexedDB, push behind the gateway).
- **iPhone: not yet tested.** Required before any iPhone is used for pilot intake.

Shared deployments: **first shared deployment 2026-11-02** (the spike server used for the
Android test). The migration squash window in §6 is **closed**: migrations 0001–0004 must never
be edited; every change is a new migration.

Backups on the shared server: tooling exists (ADR-004), activation on the server and the first
real restore test are **pending, human-run**, and must be completed before pilot intake.

M3 local verification (2026-11-02): typecheck, dependency boundaries and the production
Hub build passed. The final 100 tests passed on a fresh isolated PostgreSQL 18.4
database and on its re-run. Browser checks verified immediate offline acceptance,
later delivery/progress and a Class A review message without extra progress.
The earlier S7 pgBackRest 2.60.0 local encrypted backup was restored into a separate cluster:
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

## 10. Current task: finish Milestone 3 (S8, then S6)

Branch: continue on `m3-scanning`. Never commit to `main`. One commit per step, message
prefixed with the step ID. Each step needs tests. Schema changes only in new migrations
(`0005_…`); 0001–0004 are frozen (§3).

**Done in M3:** S1 schema · S2 intake service · S3 no-barcode flow and labels · S4 tasks and
Quick Scan · S5 offline queue · S7 backup and restore tooling · S8 physical-scan review ·
S6 warehouse scanner UI. Details:
`docs/milestones/m3-scanning.md`.

### S8 — Implement ADR-005 (Accepted): a physical scan is never lost

Read `docs/adr/ADR-005-unknown-internal-label-scans.md` first; it is the specification for
this step and replaces its Proposed version.

- Migration `0005_intake_review.sql`: `review_reason`, `reviewed_at`, `reviewed_by`,
  `review_resolution`, `review_note` on `product_intakes`; CHECK constraints for the allowed
  values and for consistency (a review resolution requires `reviewed_at` and `reviewed_by`);
  exclude intakes with a `review_reason` from `product_intakes_task_identifier_uq`.
- Intake service: Class A conditions are recorded for review instead of throwing
  (`UNKNOWN_INTERNAL_LABEL`, `ARCHIVED_INTERNAL_LABEL`, `IDENTIFIER_COLLISION`,
  `TASK_NOT_ACCEPTING`, `TASK_NOT_ASSIGNED`). A Class A intake never creates or changes catalog
  data (no draft, no identifier attachment) and never counts toward task progress; it may only
  reference an existing matching SKU. For the two task reasons, an unknown external code is
  stored as `MANUAL_IDENTIFICATION_REQUIRED` without a draft; the draft is created only when an
  admin chooses "Accept for task" (see ADR-005). Class B conditions keep their current errors.
- Review actions (ADMIN only, note mandatory, audited, idempotent): link to an existing SKU
  (with a replacement-label request when the label was wrong or archived), accept for task,
  dismiss. Choose how replacement labels enter the print queue; if this needs a schema
  change, make it in 0005 and explain it in the PR.
- Admin intake list: "Needs review" filter; review screen with the original scanned value,
  scanned time, scanner, device and task.
- Offline queue: blocked (Class B) entries are listed with a Georgian reason; their owner can
  discard after confirmation; the discard is reported to the server as
  `OFFLINE_SCAN_DISCARDED` when online.
- Online result message for Class A: "ჩაიწერა, საჭიროებს ადმინის განხილვას".
- Tests: each Class A condition creates a review intake and no SKU; offline replay of a scan
  whose task was cancelled meanwhile lands in review, not blocked; Class A intakes do not
  change task progress; each resolution path; non-admin cannot resolve; discard is audited;
  Class B conditions still fail as before.

### S6 — Warehouse scanner UI (now unblocked)

Android is confirmed behind the gateway; iPhone is not yet tested. Build S6 as specified
before (mobile, Georgian only, large targets, spec §7.3: camera scanning, manual entry, task
progress "12 / 27", immediate next scan, "✓ კოდი მიღებულია" before the server answers), with
these additions:

- **Decoder:** use `BarcodeDetector` where it exists; otherwise ZXing. Safari on iPhone has no
  `BarcodeDetector`, so the ZXing path is the iPhone path and must be fully functional.
  You may add `@zxing/browser` (exact pinned version, at least two weeks old) if
  `@zxing/library` alone is not enough for camera decoding.
- **Camera:** `getUserMedia` with the rear camera preferred; the video element must be
  inline (`playsinline`, muted); stop all tracks when leaving the screen or locking the phone;
  handle a denied permission with a Georgian explanation and a retry button.
- **Torch:** show the toggle only when the track reports torch capability.
- **Formats:** EAN-8/13, UPC-A/E, Code128, Code39, QR, DataMatrix where the decoder supports it.
- Show the Class A review message from S8 when the server answers with a review result.
- Add the iPhone checklist to `docs/milestones/m3-scanning.md` so the owner can run it:
  install to home screen, camera permission in standalone mode, scanning with the ZXing path,
  offline scan and later sync, push.

### When S8 and S6 are done

All checks in §4 green on a fresh database (twice), update §3 and
`docs/milestones/m3-scanning.md`, open a PR from `m3-scanning` to `main` listing deviations,
ADRs and `docs/` changes, and stop. Do not start M4.

## 11. Working agreement

- **Never commit directly to `main`.** One milestone (or fix list) per branch, merged by PR.
  Small commits. No unrelated refactors.
- At the end of each milestone: run §4 from a fresh database, update §3, and write a short
  summary in the PR listing every deviation from the documents, every ADR created, and every
  change you made to files in `docs/`.
- Milestones 8 and 9 (ledger, reservations, fulfillment) get an extra human review before the
  next milestone starts.
- If something is unclear, list it as an open question in the PR. Do not guess business rules.

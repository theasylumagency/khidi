# AGENTS.md — Khidi Hub

Instructions for any coding agent (Codex, Claude Code, Gemini) working in this repository.
Read this file completely before changing anything.

## 1. What this is

Khidi is a private internal hub. It is the canonical source for products, SKUs, evidence,
accounting mappings, media, storefront base prices, online stock, reservations and
fulfillment work. Two future public storefronts, run by **two legal entities**, will consume
it through a server-to-server API. Phase 1 builds only the Hub.

**Confidentiality rule.** The Hub must not reveal to customers, the public or outsiders
that both storefronts share one system. Never put a client or company name in customer-
or public-facing UI, the manifest, TOTP issuer, email sender, printed labels, internal SKU
prefixes, public or image URLs, or anything a storefront receives. Use the neutral name
"Khidi". Private internal admin screens and exports used by each entity's own authorized
staff are outside this concealment rule; they may use the stored storefront key. Do not
add an alias layer to internal price CSVs. Storefront keys are immutable after creation;
choose neutral keys because they appear in internal files and may later appear on labels.

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
| M3 Scanning, intake, labels, offline queue, backup tooling | Done — merged to `main` (PR #1). Human checks below pending |
| M4 Photo capture and media pipeline | Merged to `main`. Human deployment checks below pending |
| M5 Evidence and AI identity | Merged to `main` (PR #10). Local synthetic provider |
| M6 Review, canonical content and publishing | Merged to `main` (PR #11) |
| ADR-011 Part A / ADR-012 | Merged to `main` (PR #12); Part B remains Proposed |
| M7 Pricing | Implemented on `m7-pricing` for Draft PR review |
| M8–M11 | Not started |

Current task: M7 pricing; see [the task record](docs/milestones/m7-pricing.md).

Human checks still pending (the owner updates these lines):

- **iPhone** (ADR-002 checks and the M3 checklist in `docs/milestones/m3-scanning.md`):
  not yet tested. Required before any iPhone is used for pilot intake.
- **Thermal label printer:** not available yet. The 58 × 40 mm label has only been checked
  on screen. A real print-and-scan test is required before pilot no-barcode intake.
- **Backups on the shared server** (PostgreSQL per ADR-004, object storage per M4) and the
  first real restore test: pending, to be done before M4 is deployed to the server.

Android was confirmed behind the gateway on 2026-11-02.

Shared deployments: **first shared deployment 2026-11-02**. The migration squash window in §6
is **closed**: every existing migration is frozen; every change is a new migration.

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
# (password from .env.example), create a dedicated database khidi_test, then:
POSTGRES_USER=hub_migrator POSTGRES_DB=khidi_test \
HUB_APP_DB_PASSWORD=hub_app_dev_password PGHOST=127.0.0.1 PGPORT=5435 \
sh docker/postgres/init-roles.sh
# Set DATABASE_URL and DATABASE_MIGRATOR_URL explicitly to this khidi_test database.
corepack pnpm test                     # global setup migrates and seeds
```

Network access is only needed during setup (package install). Do not add dependencies at
task time unless the task explicitly allows it (§7).

Seeds are development fixtures: never run seeds or tests on a shared server. Both seed
entry points reject `NODE_ENV=production` and require explicit `_dev`/`_test` database names.
For shared setup use `docs/ops/server-setup.md`: migrations, worker queue deployment, then
the interactive `pnpm ops:bootstrap-admin` command, never development accounts.

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
- **Identity confidence (`skus.identity_confidence`).** `packages/evidence` computes it under
  ADR-010. Client input cannot set it. The admin's explicit confirmation for a MEDIUM SKU
  belongs to the READY transition.
- Business semantics (stock rules, reservation policies, ownership, pricing boundaries,
  lifecycle states, permissions, AI rules) may not be changed on your own. Write an ADR in
  `docs/adr/` marked **Proposed** and stop that item until it is approved.
  Implementation details (naming, structure, indexes, components) are yours to improve.

## 9. Errata (override the documents above)

- **E1 — Internal SKU format.** Internal SKUs and printed labels never contain a company
  abbreviation. Format `KH-000001`, sequence starting at 1. Applied in M2 (F2); the
  specification has been updated accordingly.
- **E2 — Superseded by ADR-010.** M5 retires manual confidence and retains prior audit entries.

## 10. Milestone 4 record — photo capture and media pipeline

Branch: `m4-media` from `main`. Never commit to `main`. One commit per step, message prefixed
with the step ID (P1…P10). Each step needs tests. Schema changes only in new migrations
(`0006_…` onward). Specification: §8 (photo intake and media), §15.2 (sellability), §16.3
(concealment), §16.5 (offline), §16.7 (backups).

### Scope boundaries (read first)

- **No AI, no OCR, no background removal in M4.** Label readability (OCR) and product
  consistency checks are M5. All image processing in M4 is deterministic (Sharp).
- **No storefront delivery.** M4 prepares public derivatives and URL building; no CDN, no
  storefront integration.
- Allowed new dependencies (exact pinned versions, each at least two weeks old):
  `pg-boss`, `sharp`, `@aws-sdk/client-s3` (and `@aws-sdk/s3-request-presigner` only if
  signed S3 URLs are needed), and a MinIO container for development in `docker-compose.yml`.
- `PHOTO_REQUEST` task type is implemented in M4. `PHYSICAL_COUNT`, `EVIDENCE_REQUEST` and
  `PICK` stay unavailable.

### Steps

**P1 — Object storage layer + ADR-006.** One storage interface in `packages/media` with an
S3 implementation (MinIO in development, S3-compatible in production) and a filesystem
implementation for tests and Docker-less environments.
- Write-once for raw originals and evidence: the storage layer refuses to overwrite an
  existing key; the SHA-256 of every raw file is stored and verified on read.
- Private area for `raw/`, `master/` and `evidence/`; a separate public area for published
  derivatives only. Object keys use image ids, never SKU ids or `KH-` numbers.
- ADR-006 records the storage choice, bucket versioning, replication to a second location,
  deletion protection for raw and evidence, and how storage is covered by backups and the
  restore runbook (extend `docs/ops/backup-restore.md`).

**P2 — Schema** (`0006_media.sql`). `product_images` based on plan §2.3, with these changes:
- `sku_id` nullable, `intake_id` nullable, at least one of them set. Photos of Class A review
  intakes have no SKU yet; when a review resolution links the intake to a SKU, its photos are
  linked to that SKU in the same transaction.
- Foreign keys `ON DELETE RESTRICT` (never CASCADE); no DELETE for `hub_app`.
- Add `raw_sha256`, `raw_bytes`, `mime_type`, `width`, `height`, `captured_at` (device),
  `device_id`, `idempotency_key` (unique), `reject_reason`.
- `IDENTIFICATION` photos default to `usage = INTERNAL_EVIDENCE`, `role = IDENTITY`.
- Master versions: a reprocessing creates a new version; earlier versions stay.

**P3 — Upload API.** Uploads go through the Hub API (behind the gateway), never directly from
the phone to object storage.
- Idempotent per photo (`Idempotency-Key`), size limit 15 MB, JPEG/PNG/WebP only; other
  types are rejected with a Georgian message. The raw original is stored byte-for-byte.
- Permissions: the scanner of an intake uploads its photos; a warehouse user uploads for a
  `PHOTO_REQUEST` assigned to them; ADMIN uploads for any SKU or intake.
- Creating the image row and enqueuing its processing job happen in one transaction
  (outbox or transactional enqueue). No fire-and-forget.

**P4 — Guided capture UI** (mobile, Georgian only). After an intake is accepted, if the task
requires photos, the user goes straight into capture; then to the next scan.
- Slots and instructions come from the Product Type's `photoInstructionsJson` when the SKU's
  type is known; otherwise the three generic slots of spec §8.1.
- An overlay frame shows where to place the product.
- Capture method: choose between camera stream capture and the native camera
  (`<input type="file" accept="image/jpeg" capture="environment">`) and record the choice in
  ADR-007. Acceptance criteria for the choice: MAIN and SECONDARY at least 1920 px on the long
  edge; IDENTIFICATION sharp enough to read a model plate; works on Android and in an
  installed PWA on iPhone.
- **Tier-1 checks on the device**, before the photo is accepted, offline-capable: blur
  (e.g. Laplacian variance on a downscaled grayscale copy), severe under/over-exposure
  (clipped histogram share), minimum resolution. Thresholds are configuration. Failure shows
  "⚠ ფოტო ბუნდოვანია, გადაიღეთ თავიდან" or the matching message; success shows
  "✓ ფოტო მიღებულია".
- Required slots cannot be skipped. A "can't photograph" action records a reason and marks
  the intake for admin attention; nothing is lost.
- **Photos belong to the original intake, never to a duplicate.** A repeat scan in an
  `INTAKE_UNIQUE` task (a duplicate, or a scan of a printed `KH-` label to confirm attachment)
  never starts photo capture by itself. It shows "უკვე დასკანერებულია" with the photo status
  of the original intake. If that original intake still misses required photos, the screen
  offers "ფოტოების დასრულება", which captures only the missing slots and stores them on the
  original intake. Any user assigned to the task, and ADMIN, may complete them.
- **Slots already covered:** when the scan matches a SKU that already has a VERIFIED image for
  a slot, that slot is optional for this intake (shown as "ფოტო უკვე არსებობს — გამოტოვება ან
  ხელახლა გადაღება").
- **Deciding offline whether to start capture.** The warehouse never waits for the server.
  - When a task is opened online, the device caches the task's already-scanned normalized
    identifiers; together with the device's own queued scans this is the local duplicate list.
    Normalization runs with the same shared code as on the server.
  - A scan found in the local duplicate list → no automatic capture (duplicate rule above).
    Any other scan → capture starts immediately, online or offline.
  - If the server answer arrives before the first photo is taken and says "duplicate", the
    capture screen closes with the duplicate message.
  - Offline, the "slots already covered" rule cannot be known, so all required slots are asked.
- **Late duplicate detection.** If photos were already taken for a scan that the server later
  classifies as a duplicate, they are kept and stored on the original intake as additional
  UNVERIFIED candidates for their slots. They never replace or overwrite existing images, even
  when the slot is already filled; the admin chooses in P8, and the P6 perceptual-hash check
  flags near-identical photos.

**P5 — Offline photo queue.** Extend the S5 queue:
- Photos are stored as blobs in IndexedDB with the same per-user ownership rules as scans.
- A photo is sent only after its intake has been delivered (dependency on the intake's
  idempotency key).
- Call `navigator.storage.persist()`; show used storage; warn at 80 % of the estimated quota;
  at 95 % block new captures with a Georgian explanation. Never drop a queued photo silently.
- **Photos of a blocked (Class B) scan** are never uploaded on their own: they stay queued
  and are shown under that blocked scan. If the owner discards the scan, its photos are
  discarded with it in the same IndexedDB transaction; the confirmation dialog states the
  number of photos ("სკანი და მისი N ფოტო წაიშლება"). The `OFFLINE_SCAN_DISCARDED` report
  includes photo metadata only (count, slots, SHA-256, bytes, captured time), never image bytes.
- **A photo blocked on its own** (Class B rejection of the photo, while its intake was
  delivered) is shown with its reason; the owner may retake it or discard it. A discard is
  reported as `OFFLINE_PHOTO_DISCARDED` (metadata only), and the server marks the intake
  "required photos missing" for admin attention, so an admin can issue a PHOTO_REQUEST.

**P6 — Worker and image processing.** Introduce `pg-boss` in `apps/worker`.
- The pg-boss schema is created and migrated by `hub_migrator` in a deploy step; the runtime
  uses `hub_app` with explicit grants.
- Job `process-image`: raw → master (auto-orient, sRGB, all metadata including EXIF GPS
  stripped) → 1:1 canvas on a light neutral background with consistent padding → web
  derivatives 400/800/1600 px in WebP and AVIF. Deterministic only (spec §8.5).
- Job `tier2-image-check` (deterministic part only): resolution and perceptual-hash duplicate
  detection within the same SKU. "Product fully in frame" and label readability are M5.
- Retries with backoff, idempotent jobs, dead-letter, job status visible to ADMIN with a
  retry action. Rename the worker service label from `agrotrade-worker` to `khidi-worker`.

**P7 — PHOTO_REQUEST tasks.** ADMIN requests specific slots for a SKU with a note; it appears
in the assignee's warehouse task list; it completes when every requested slot has an uploaded
photo that passed Tier-1. Rejecting an image (P8) offers "request a new photo".

**P8 — Admin image management** on the SKU page: raw, master and derivatives (private
images through short-lived signed URLs); set role, usage and sort order; verify or reject with
a reason; reprocess. **Sellability:** add "at least one VERIFIED, PUBLIC, MAIN image" to the
evaluator in `packages/publishing` (spec §15.2).

**P9 — Public derivatives.** Only VERIFIED PUBLIC images of READY SKUs are copied to the
public area. Public object names use the canonical slug, e.g.
`{canonical_slug}-{n}-{width}.{webp|avif}`; never internal ids, `KH-` numbers or the Hub
hostname. A function builds public URLs from a storefront's `media_base_url`. When an image is
rejected or a SKU leaves READY, its public copies are withdrawn.

**P10 — Operations.** Development MinIO with versioning enabled; ops scripts to enable
versioning, replication and deletion protection on the production bucket; the restore
verification covers a sample of raw files (SHA-256 match after restore).

### Acceptance

- Fresh database: §4 checks pass twice in a row (tests use the filesystem storage adapter;
  S3 integration tests run when MinIO is available).
- Tests cover: raw stored byte-for-byte and never overwritten; SHA-256 verified; EXIF GPS
  absent from master and all derivatives (use a fixture JPEG with GPS data); derivative sizes
  and formats; reprocessing creates a new master version; idempotent upload replay; upload
  permissions per role; photo for a Class A intake linked to the SKU on review resolution;
  Tier-1 checks on synthetic sharp/blurred/dark images; offline photo queue ordering after its
  intake and per-user ownership; quota thresholds; PHOTO_REQUEST lifecycle; job retry and
  dead-letter; sellability blocked without a verified public main image; public names contain
  no internal ids; public copies withdrawn on rejection.
- Update §3, write `docs/milestones/m4-media.md` (including an iPhone and Android capture
  checklist for the owner), open a PR from `m4-media` listing deviations, ADRs and `docs/`
  changes, and stop. Do not start M5.

### Notes for later milestones

- **M8 physical counts:** the camera scanner treats a code that leaves the frame for 0.8 s as
  a new scan. That is harmless for unique intake but would overcount in `PHYSICAL_COUNT`.
  Counting needs an explicit per-unit confirmation (or an equivalent safeguard); decide it in
  an ADR during M8.

## 11. Working agreement

- **Never commit directly to `main`.** One milestone (or fix list) per branch, merged by PR.
  Small commits. No unrelated refactors.
- At the end of each milestone: run §4 from a fresh database, update §3, and write a short
  summary in the PR listing every deviation from the documents, every ADR created, and every
  change you made to files in `docs/`.
- Milestones 8 and 9 (ledger, reservations, fulfillment) get an extra human review before the
  next milestone starts.
- If something is unclear, list it as an open question in the PR. Do not guess business rules.

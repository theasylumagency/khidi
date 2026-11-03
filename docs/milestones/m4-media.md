# M4 — Photo capture and media pipeline

Branch: `m4-media`, based on `main` at `4b169136cd50564ec67532d7c97dfefd257618a0`.
P1–P10 are separate commits, followed by the owner's pre-merge fixes below.
M3 history and applied migrations are unchanged.
No production environment, shared data, seed contents or storefront/entity records were
changed by this implementation. No M5 work, AI, OCR, background removal, CDN or storefront
integration is included.

## Implemented

- Write-once private raw/evidence/master storage, SHA-256 checked reads, filesystem and
  S3 adapters, separate public copies and retained master versions.
- Bounded idempotent Hub uploads, per-role/per-intake authorization, Class A photos linked
  only by the audited admin resolution, transactional processing jobs.
- Georgian guided capture, native-camera/file capture plus optional framed stream,
  offline Tier-1 quality checks, mandatory-slot completion or a recorded inability reason.
- Per-user IndexedDB blobs, delivery dependencies, retry/backoff, quota warning/block,
  blocked-scan/photo handling and durable metadata-only discard reports.
- pg-boss deploy/runtime role separation, metadata-free sRGB square master and six WebP/AVIF
  derivatives, deterministic per-SKU similarity flags, retries, dead-letter and admin retry.
- Assigned PHOTO_REQUEST work, admin image review, rejection reasons, role/usage/order,
  signed private views, new processing versions and a database-backed media sellability fact.
- Eligible public copies, neutral slug-based names, per-storefront URL building, durable
  publication/withdrawal intents and cleanup after partial storage failures.
- Development MinIO, restricted storage account, production protection planning/apply
  scripts, raw sample manifests and combined recovery verification with a separate test clone.

## Clarifications and deviations

The owner's P4/P5 decisions are implemented as recorded in AGENTS.md: duplicates never
start automatic capture when locally known; original-intake completion is shared with
assigned task members; already-verified SKU slots are optional; unknown local scans start
capture without waiting for the network; late duplicate photos remain additional
UNVERIFIED candidates on the original intake. Blocked scans and their photos are discarded
atomically only after owner confirmation, with metadata-only reporting. Independently
discarded photos mark required photos missing for admin attention.

The device caches normalized task identifiers, uses the same normalization code as the
server and includes its own queued/delivered scans. Offline capture asks all generic required
slots. A duplicate reply closes an untouched capture screen. If the OS file/camera chooser
is already open, its result is preserved rather than losing an in-progress native capture;
cancelling the chooser closes the untouched duplicate flow.

The initial schema is `0006_media.sql`; follow-up migrations `0007`–`0010` add contract
checks, original-intake constraints/covered-slot snapshots, retry generations and durable
publication intents. These were added instead of rewriting migrations already verified
locally. Private links are authenticated Hub HMAC URLs rather than signed S3 URLs, so no
presigner dependency was needed. Publication/withdrawal is an audited durable worker flow
across PostgreSQL and object storage; the URL projection removes ineligible images
immediately, and physical public-object deletion follows the queued job.

The upstream MinIO binary images are unavailable. The development container is built from
an exact upstream security-release source commit and includes a pinned official admin CLI.
It is a local fixture; production protection targets the operator's S3-compatible service.
The prior restore verifier now creates a new `_test` clone after checking the recovered
database; the hard database test guard is preserved, with no override.

Technical decisions: [ADR-006](../adr/ADR-006-immutable-object-storage.md) and
[ADR-007](../adr/ADR-007-photo-capture-and-tier1.md).

## Owner's pre-merge fixes — 2026-11-03

Server Tier-1 is advisory. Device/server quality reports are retained separately and a
disagreement flags the original intake for admin attention without losing uploaded-slot
progress or the raw file. Acceptance uses `failOn: "error"`; minor camera JPEG warnings
are accepted, while unsupported/undecodable files, size and decompression-bomb limits
still reject. Admin review exposes both reports. ADR-007 records the superseding rule.

Foundation/product seeds now guard production and both explicit database-name suffixes
before creating a DB client. New local defaults use `_dev`; real shared data and seed
contents are unchanged. The production-only interactive `ops:bootstrap-admin` creates one
ADMIN only in an empty users table, with hidden password entry, audit/outbox and mandatory
first-login TOTP enrollment. New migration `0011_admin_bootstrap.sql` stores that enrollment
requirement. Enrollment does not issue a session before the code is confirmed. Setup and
shared-server prohibitions are recorded in [server-setup.md](../ops/server-setup.md).

## Verification

Automated acceptance uses an isolated PostgreSQL 18.4 container on port 5438 and a dedicated
`khidi_m4_followup_acceptance_test` database. The full suite passes on a fresh database and on
the same database a second time: **38 files, 198 tests each**, including the real MinIO S3 test.
The storage test uses the restricted runtime account and verifies immutable bytes, pinned
version reads, hash verification, denial of raw version deletion/delete markers and
withdrawal of public copies. Protection/replication planning and raw restore hashes have
automated tests. A real isolated `_test` recovery clone was created successfully. With
the local Hub and worker stopped, the recovery CLI captured twelve uploaded raw files,
copied them to separate storage and verified all twelve SHA-256 hashes, byte counts and
metadata against a separate recovered database clone. This local drill does not certify
the shared server's backup or replication configuration.

Typecheck, boundaries/lint and the production build pass. Browser validation uses synthetic
1920 px fixtures and a separate `khidi_m4_ui_test` database: immediate new-scan capture,
all three required slots, local duplicate suppression, offline photos waiting for their
intake, reconnect delivery, worker processing, signed previews and audited admin verification.
The browser checks found and fixed an empty offline completion view and a narrow admin
panel layout. Pending-photo completion also follows delivery receipts back to the original
intake without changing the immutable queued upload input. These checks do not certify
physical Android/iPhone camera behavior.

The non-test database safety demonstration aborts with `SAFETY:` before migrations/seeds;
the isolated database remains without migration or foundation tables afterward.
Both seed CLI entry points also demonstrate a production-mode `SAFETY:` refusal using local
fixture URLs. `pnpm test:safety` passes **43 guard tests without PostgreSQL**. An interactive
bootstrap drill on a separate local `_test` database confirms no password echo, one ADMIN,
mandatory pending TOTP and an audit row; entities/storefronts/devices/settings stay empty.

## Owner's Android and iPhone checklist

Run on each real device behind the access gateway, including an installed iPhone PWA.
Record OS/browser version, device model, date and pass/fail evidence before pilot use.

- Open an assigned intake task online, then disconnect. Scan a new identifier and confirm
  capture starts immediately. Repeat a known local code and confirm no automatic capture.
- Capture MAIN and SECONDARY with at least 1920 px on the long edge. Confirm a model plate
  is readable at original size. Verify device blur/dark/bright/small-image failures and retake.
- Exercise native rear camera, picker and optional stream; inspect the framing overlay,
  rotate the phone, deny camera access, background/lock it and return. Camera tracks stop;
  granting/retrying access and continuing scanning works without duplicate captures.
- Complete only missing slots on an original intake, including with another assigned user.
  Verify optional covered slots and KH-label attachment confirmation without new capture.
- Deliver a duplicate reply before the first capture; then repeat with photos already taken
  offline. The latter appear as additional UNVERIFIED original-intake candidates.
- Keep photos pending offline, reconnect and reload/reopen the app. IndexedDB retains the
  files and intake delivery precedes photo delivery. Cold offline navigation is not promised:
  the service worker still does not cache HTML or API responses. Switch PIN users: previous
  entries retain ownership and named counters; they upload only with the correct user's session.
- Exercise storage persistence and usage display; at 80% show a warning, at 95% block new
  captures without removing queued files. Record the browser's actual persistence behavior.
- Block a scan with photos. Confirm photos stay beneath it, and owner discard confirmation
  states the count. Confirm only metadata reaches OFFLINE_SCAN_DISCARDED. Independently
  block a photo, retake/discard it, and confirm admin attention and OFFLINE_PHOTO_DISCARDED.
- Complete an assigned PHOTO_REQUEST online/offline, verify task closure after all required
  uploads pass Tier-1, and verify rejection offers a new request.

## Deployment gates still owned by the human

Before M4 deployment, configure and verify PostgreSQL backups, private object versioning,
second-location encrypted replication, deletion protection and the first real combined
restore, including raw SHA-256 samples. Provision a restricted storage runtime account,
deploy pg-boss as the migrator, then run the worker as `hub_app`. Monitor dead-letter work.
The iPhone gateway/PWA check and physical thermal-printer print-and-scan check remain
pending as recorded in AGENTS.md. M4's physical photo-capture checklist is a separate check
from the already-confirmed M3 Android gateway spike.

## Documentation changes

- Added ADR-006 and ADR-007.
- Extended `docs/ops/backup-restore.md` with media recovery and safe test clones.
- Added `docs/ops/media-storage.md` with development, protection and restore commands.
- Added `docs/ops/server-setup.md` for seed-free production setup and first-admin enrollment.
- Extended `docs/testing.md` with recovery-clone and MinIO test setup.
- Added this milestone record and updated the milestone status in AGENTS.md.

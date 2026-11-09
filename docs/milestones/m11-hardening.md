# M11 — Hardening, restore and end-to-end verification

Base: main `17d286bee1d6acff6e91fac4f88f69488dcc8aa6`, merged PR #17.
Branch: `m11-hardening`. Existing owner changes and other worktrees remain untouched.
One commit per H1–H9; Draft PR only, no shared database access, merge or deployment.

## Initial findings

- Production audit confirms three advisories: Drizzle identifiers (high), Zod collection
  validation (high), and ExcelJS's UUID buffer methods (moderate).
- Restore verification still checks an M4-era table list and creates an empty test database;
  M11 must also verify current inventory/report data and run A–D against an isolated
  writable clone of the restored state, without seeds or migrations on the recovered copy.
- Webhook and push transports omit reserved/documentation address ranges from their
  public-address checks. Request parsing often buffers bodies before checking their size.
- Production preflight checks only WebAuthn. Runtime validation must cover application
  secrets and storage, with deployment-only credentials kept out of runtime services.
- The owner added H9 user management, including secure employee setup and second-admin creation.
  There are no existing staff accounts to migrate; all new office accounts require TOTP.

## Verification budget

Focused tests during work; the full suite at final acceptance on a fresh isolated
`_test` database, plus typecheck, lint, boundaries, build, production audit and the local
MinIO/pgBackRest restore drill. H6 scenarios run on a clone of the restored state; they
do not run seeds or arbitrary background deliveries from restored production data.
Repeat the full suite only for a demonstrated failure or changed test infrastructure.

## H1 — dependency security and input limits

Drizzle is pinned everywhere to 0.45.4. ExcelJS's single UUID call site is v4() without
buffers; its parent-specific override is 11.1.1. pnpm 12 requires overrides in
pnpm-workspace.yaml (the old package.json pnpm field is ignored); this is the equivalent
supported location, not an advisory exclusion. Zod stays at 3.24.2 with streaming byte
limits, a pre-validation structural budget, explicit schema caps and record preflight.
See dependency-audit.md and Proposed ADR-015 for the residual high finding.

Focused verification: 29/29 passed across input limits, identifier escaping on real
PostgreSQL, extended XLSX formatting, evidence/content and storefront HTTP behavior.
Hub/report/product/evidence typechecks and boundaries passed. Final audit currently has
one documented high (Zod), zero critical; Drizzle/UUID findings are removed.

## H2/H3 — security review and production configuration

Private browser writes now enforce exact origin and bounded JSON/MIME or multipart/CSV bytes;
server-to-server API rules stay separate. Public outbound destinations share a conservative
IPv4/IPv6 policy with bounded DNS/response time and bytes. Credential responses are no-store,
and operations no longer print raw driver errors. The security review records the checklist.
Focused security tests: 74 existing/new tests passed, then 15 further origin/host/push/evidence
checks passed; the two new origin-reader test call-shape failures were corrected and passed.
Shared, Hub, publishing, notifications typechecks and dependency boundaries passed.

Production preflight now checks app/deployment DB roles and pairing, non-development encryption,
signing/proxy secrets, exact hosts/RP/origin, matching VAPID keys, storage and backup metadata.
App and worker run the same pure guard before starting; runtime needs no migrator/backup secrets.
Seven configuration/architecture tests and shared/Hub/worker typechecks passed.

## H9 — owner-approved user management

ADMIN-only user creation, editing, lifecycle and resets require recent strong proof. Setup
links are hashed, expiring, single use and returned once. The employee sets their credentials;
new office accounts confirm TOTP before any session, warehouse setup requires an active device.
Every change is audited with an outbox event; access changes/deactivation revoke sessions,
push and pending links. Resets revoke passkeys; deactivation preserves stored factors.
The last active ADMIN is protected in PostgreSQL. Old applied migrations are unchanged.
New 0051–0054 retain the pending-TOTP block for legacy office accounts with a PIN and
make the last-admin check independent of temporary-table search paths.
The report-access screen also requires strong proof and revokes obsolete sessions.

See user-management.md for operation, lost responses, explicit account switching and recovery.
Thirteen domain lifecycle tests passed; HTTP authorization/setup and the existing recovery
regression tests passed (16/16). Other focused authentication/report tests passed before the
two discovered integration issues were corrected. Auth/report/Hub typechecks and boundaries pass.

Client retries retain the command's idempotency key until the response body is received;
lost headers or truncated JSON cannot duplicate a warehouse account. HTTP regression checks
both losses. A replay returns metadata only; issue a new link when its original response was lost.
Setup account switching also pauses the old session monitor after successful logout so it
cannot race the token-preserving redirect. Its two client regressions pass.

## H4 — ordered deployment and recovery runbook

The runbook covers separate app/API DNS, TLS and Access boundaries; trusted proxy headers,
IP/body/time limits; PostgreSQL roles; protected storage and encrypted backups; migrations and
queue deployment; interactive bootstrap and H9 second ADMIN; production service commands,
health/log rotation; backup-first upgrades and restore-based rollback. App binds loopback;
both app and worker launchers preflight runtime configuration without migrator credentials.
No gateway configuration, shared service or environment file was changed.

## H5 — real local restore drill

`pnpm ops:restore-drill` passed with PostgreSQL 18.4, pgBackRest 2.60.0 and separate MinIO
source/recovery storage. An encrypted full backup plus WAL was restored into clean PGDATA.
The initial drill verified 54 migrations and 98 table counts; the H10 repeat verified 55 and 99.
All 37 copied objects matched SHA-256 in both drills;
25 private database references, including raw, masters, derivatives, PDF evidence and reports,
were readable and correct, including two raw samples. Inventory verification and A–D passed.
The recovered original's counts stayed unchanged while H6 ran on a separate writable clone.
See `m11-restore-result.json`. The local root-group mapping warning is recorded there.
This is synthetic local evidence, not certification of the owner's shared-server backup.

Restore review found that copied objects receive new version IDs. A missing recorded version
may fall back to the immutable key only with the recorded SHA-256 check; authorization failure
and corruption never fall back. Focused storage/restore safeguards: 13/13 passed.

## H6 — scenarios A–D

Service/real HTTP scenarios cover no-barcode identity and photos through both-store sellability,
declared own/consignment availability, low-stock/replenishment isolation, CARD and one-call
COD/pickup, signed AUTO_ASSUMED provenance, idempotency, last-unit concurrency and expiry,
snapshot reports and documented cross-entity purchase transfer. Existing controlled workflow
tests remain. The full-suite scenario passed in 9.2 seconds; the restore drill also passed it.
Only scenario-owned events are consumed; restored background deliveries never run arbitrarily.

## H7/H8 — maintenance and human acceptance

`docs/CURRENT-STATE.md` maps ADR-001–014 to superseded specification/plan text and records the
remaining decisions. AGENTS now describes maintenance with bounded fixes and frozen migrations.
The owner checklist covers real recovery, keys/protection, a second ADMIN, phones/gateway,
camera/offline/push, labels, API-key handover and the accepted declared-stock/automatic-handover
risks. No real-device or shared-server box is marked complete by local tests.

## H1–H9 acceptance

- Full suite on fresh `khidi_m11_acceptance_test`: **114 files, 628 tests passed**, no skips,
  including real MinIO S3 integration, in 399.47 seconds.
- After the final client response-loss refinement: user HTTP tests **4/4 passed** (including
  truncated body). Expanded promotion/office↔warehouse lifecycle assertions: **13/13 passed**.
  The full suite was not repeated for this local client refinement/test expansion.
- Production audit: **0 critical, 1 high, 0 moderate, 0 low**. The remaining Zod finding and
  bounded-input mitigations are explicit in `docs/security/dependency-audit.md`; Proposed ADR-015
  tracks the separate Zod 4 migration. No advisory is suppressed.
- `pnpm typecheck`, `pnpm lint`, `pnpm check:boundaries` and `pnpm build`: **passed**.
  Production build used temporary synthetic configuration and a dedicated local test database;
  no filled environment file or shared configuration was changed.

The first full attempt exposed Drizzle 0.45's wrapped PostgreSQL errors, a task test that
inadvertently included new pending-TOTP setup accounts, and a property-test timeout while heavy
build/check/restore processes competed. Domain error translators now inspect a bounded SQLSTATE
cause chain without logging query parameters; assertions still check the original database
invariants. Task-role fixtures explicitly cover valid accounts for every role. The original
property-test seed passed independently in 42.7 seconds with its unchanged 75-second limit.
The final fresh-database run above followed these demonstrated fixes; no test was weakened.

## Deviations and unresolved decisions

- H9 is the owner's explicit M11 scope addition; there are no existing staff accounts requiring
  a migration/backfill. New office setup always requires TOTP.
- Zod remains at 3.24.2 under the task's explicit mitigation path, pending ADR-015 approval.
- pnpm 12 overrides live in `pnpm-workspace.yaml`, where the ExcelJS UUID override is effective.
- H6 uses a writable clone of the recovered state so the recovered original remains unchanged.
- The owner resolved the empty-installation blocker in H10: approved neutral catalog reference
  data gets its own command, and all real business setup uses ADMIN UI. See the [H10 record](m11-h10-reference-setup.md)
  for the complete taxonomy comparison, missing future subtype/spec tables and plate observations.
- Existing open decisions (#2 operating ownership/contract, #8 component price allocation,
  ADR-011 Part B) and deferred R8/physical counts/report email/live AI remain unchanged.
- Real-server restore and all human pre-pilot checks remain the owner's responsibility.

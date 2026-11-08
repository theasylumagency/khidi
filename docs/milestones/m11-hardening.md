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

Focused tests during work; the full suite once at final acceptance on a fresh isolated
`_test` database, plus typecheck, lint, boundaries, build, production audit and the local
MinIO/pgBackRest restore drill. H6 scenarios run on a clone of the restored state; they
do not run seeds or arbitrary background deliveries from restored production data.

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

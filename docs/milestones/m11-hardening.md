# M11 — Hardening, restore and end-to-end verification

Base: main `17d286bee1d6acff6e91fac4f88f69488dcc8aa6`, merged PR #17.
Branch: `m11-hardening`. Existing owner changes and other worktrees remain untouched.
One commit per H1–H8; Draft PR only, no shared database access, merge or deployment.

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
- First-admin bootstrap exists, but second-admin provisioning has no implementation.
  The owner has been asked to choose its authenticated provisioning interface.

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

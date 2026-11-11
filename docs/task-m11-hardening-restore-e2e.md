# Khidi — Milestone 11: Hardening, Restore & End-to-End Verification

Repository: `theasylumagency/khidi`

Final milestone before the pilot. Branch `m11-hardening` from the latest `main` (after PR #17).
One commit per step. Draft PR at the end; do not merge or deploy.

## 1. Read first

- `AGENTS.md`, Implementation Plan v1.1 Milestone 11 and §6 (risks)
- Specification v1.2 §16 (security, concealment, backups), §17.3 (Definition of Done)
- ADR-002, ADR-004, ADR-006, ADR-013, ADR-014
- `docs/ops/*` (especially `server-setup.md`, `backup-restore.md`, `media-storage.md`,
  `storefront-api.md`), `ops/*` (backup, restore, verify-restore, media-restore,
  check-production-config, bootstrap-admin, storefront test client)

The plan and the specification predate ADR-013 and ADR-014. Where they disagree, the ADRs win.
Examples: physical counts, marked online shelves (C13) and the plan's risk R2 no longer apply;
fulfillment is simplified by default.

## 2. Steps

**H1 — Dependency security.** `pnpm audit --prod` currently reports:
- `drizzle-orm` 0.40.0 — SQL injection via improperly escaped identifiers, fixed in 0.45.2;
- `zod` 3.24.2 — memory exhaustion validating oversized constrained collections, listed as fixed
  in 4.6.6;
- `uuid` inside `exceljs` — missing buffer bounds check in v3/v5/v6.

Do this:
- Upgrade `drizzle-orm` to a patched version (exact, at least two weeks old) everywhere; fix
  breaking changes; full suite green.
- `zod`: check whether a patched 3.x release exists. If yes, upgrade. If not, do **not** migrate
  to zod 4 in this milestone; instead apply mitigations — request body size limits at the
  application and documented for the reverse proxy, explicit `.max()` on every array, record and
  string in externally reachable schemas (storefront API, uploads, CSV import) — and write a
  Proposed ADR for the zod 4 migration.
- `uuid` via `exceljs`: verify whether the vulnerable call path (buffer argument) is used. If not,
  document it; if possible, override to a patched `uuid` via `pnpm.overrides` with tests green.
- Finish with `pnpm audit --prod` showing no high or critical findings, or each remaining one
  documented with reason and mitigation in `docs/security/dependency-audit.md`.

**H2 — Security review.** Write `docs/security/review-m11.md` as a checklist with findings and
fixes, covering at least: authorization on every page and route (the architecture test),
storefront key scoping and host isolation, CSRF and cookie flags, security headers and CSP
(no `unsafe-eval` in production), rate limits (login, PIN, API), upload size and type limits,
request body limits, error responses without stack traces in production, log redaction (no
secrets, TOTP, raw keys, webhook secrets, personal data), webhook SSRF protection, signed media
URLs, append-only enforcement, and dependency pinning. Fix what is found. Known item to fix: the
webhook public-address check also rejects `192.0.0.0/24`, `192.0.2.0/24`, `198.51.100.0/24`,
`203.0.113.0/24` and `192.88.99.0/24`.

**H3 — Production configuration check.** Extend `ops/check-production-config.ts` so it verifies,
before start, every required production variable: `NODE_ENV=production`, database URLs and roles,
encryption keys (not development defaults), WebAuthn RP ID/origin consistency, `KHIDI_API_HOST`
and `KHIDI_PROXY_TOKEN` (length), VAPID keys (not development keys), object storage endpoint,
buckets and credentials, backup configuration. Complete `ops/hub.production.env.example`. The
app and worker refuse to start when the check fails.

**H4 — Deployment and operations runbook.** Consolidate `docs/ops/server-setup.md` into one
ordered runbook: DNS and TLS for the app host and the API host; Cloudflare Access in front of the
app host only (never the API host); reverse proxy with the proxy token and client IP header; body
size limits; PostgreSQL 18 and roles; migrations; pg-boss and media job deployment; object storage
with versioning, Object Lock for raw media and evidence, replication; pgBackRest schedule;
`bootstrap-admin` and a second ADMIN; worker process and health checks; log rotation. Add an
**upgrade procedure** (backup → migrations → restart app and worker → smoke test) and a
**rollback policy** (migrations are forward-only; rollback means restore from backup).

**H5 — Restore drill tooling.** One documented command that restores PostgreSQL and object
storage into a clean environment (`ops/compose.restore-test.yml`), then runs
`verify-restore`, `inventory:verify`, media SHA-256 checks and the end-to-end scenarios of H6
against the restored copy. Run it locally (with MinIO) and report the result. The real drill on
the shared server is performed by the owner.

**H6 — End-to-end scenarios** (replace spec §17.3 for the current design). Automated at service
and HTTP level using the existing test storefront client; no browser automation:
- **A — Catalog:** intake with a no-barcode product → evidence → identity → approved KA content →
  READY → listing and price on both storefronts → publish-ready and sellable once availability
  exists.
- **B — Declared availability (ADR-013):** set availability on a storefront using its own pool and
  on a storefront using a CONSIGNMENT pool; low-stock notification; replenishment request closed
  by a new declaration; the other storefront's allocation unchanged.
- **C — Storefront sale, simplified mode (ADR-014):** CARD reserve → payment success → automatic
  completion → signed webhook with `AUTO_ASSUMED` → seller and owner report lines with snapshots;
  parallel reservation of the last unit — exactly one succeeds; expiry releases; COD/pickup in one
  call.
- **D — Cross-entity:** a CONSIGNMENT sale appears in the seller report of the selling entity and
  the owner report of the owning entity; a PURCHASE pool transfer with a document reference
  appears on both sides; switching CONSIGNMENT → PURCHASE is blocked until the storefront moves
  to another availability pool.
Controlled-mode fulfillment stays covered by its existing domain tests.

**H7 — Current-state documentation.** Write `docs/CURRENT-STATE.md`: how the system works today
with ADR-001…014 applied, which specification and plan sections are superseded (list them), and
the open decisions: Hub ownership and contract (#2), bundle price split (#8), ADR-011 Part B,
controlled-mode warehouse UI (R8), physical counts, email delivery of reports, zod 4 migration.
Update `AGENTS.md` for maintenance mode (no current milestone; how to start a change).

**H8 — Pre-pilot checklist for the owner.** `docs/ops/pre-pilot-checklist.md` with the human
checks: restore drill on the server; PWA, camera, offline queue and push on a real Android phone
and iPhone behind the gateway; thermal label print-and-scan; second ADMIN created; production
VAPID, WebAuthn and encryption keys set; Object Lock and replication verified; storefront API key
handed over securely; the accepted risks of ADR-013 and ADR-014 explained to the client.

## 3. Verification and delivery

Focused tests while working; once at the end: typecheck, lint, boundaries, build, `pnpm audit
--prod`, the full suite on a fresh `_test` database, and the H5 restore drill locally. Never touch
the shared database; no deployment. Update `AGENTS.md`, open a **Draft PR**, and report the PR
link, head SHA, changed files, test and audit results, the restore drill result, and any
remaining risks.

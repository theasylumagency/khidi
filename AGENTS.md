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
| M2 Product model | Done (F1–F7 and G1–G2 done) |
| M3 Scanning, offline queue, backups | Not started — ready after `m2-close` review |
| M4–M11 | Not started |

Shared deployments (any database outside a developer machine): **none yet**.
Record the date here the first time a database is deployed to a shared or staging server;
from that moment §6 "Migration squash window" is closed.

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

## 10. Open items before M3

Work on branch `m2-close`. One commit per item, message prefixed with the item ID.
Each item needs tests.

**Done (M2 fix list):** F1 lifecycle state machine and READY preconditions · F2 neutral
`KH-` internal SKU · F3 differentiator in variant slugs · F4 status and provenance for
universal fields · F5 GTIN-14 normalization, system-only internal identifiers, advisory lock ·
F6 Vitest global setup · F7 no DELETE on core catalog tables.

**G1 — Identity confidence as a separate audited action.**
`/api/products/ready` currently accepts `identityConfidence` in the request body, so an admin
can set HIGH and pass the READY gate in the same call.
- Remove `identityConfidence` from the READY request and from `transitionSkuLifecycle` options.
- Add `setSkuIdentityConfidence(db, actor, skuId, level, reason)` in `packages/products`:
  ADMIN only, `reason` mandatory (non-empty), not allowed on ARCHIVED SKUs.
- Audit it as `IDENTITY_CONFIDENCE_SET_MANUALLY` with before/after values and the reason.
- Expose it as its own route and its own UI control on the SKU page, with the reason field.
- Tests: READY request with a confidence field is rejected or ignored; non-admin is rejected;
  missing reason is rejected; audit row is written.

**G2 — Sequential test files.**
The M2 fixes removed `fileParallelism: false`, so test files now run in parallel against one
shared database. Restore it in `vitest.config.ts` (keep `globalSetup`), and keep an explicit
`include` for `packages/**/*.test.ts` and `apps/**/*.test.ts`.
Acceptance: fresh database → `pnpm test` passes twice in a row.

**Deferred to M6 (do not do now):** include the slug differentiator whenever it exists,
not only when a sibling SKU already exists at approval time. Today the first variant of a
family keeps a generic slug.

When G1 and G2 are done: all checks in §4 green, update §3, open a PR from `m2-close`, and stop.

## 11. Working agreement

- **Never commit directly to `main`.** One milestone (or fix list) per branch, merged by PR.
  Small commits. No unrelated refactors.
- At the end of each milestone: run §4 from a fresh database, update §3, and write a short
  summary in the PR listing every deviation from the documents, every ADR created, and every
  change you made to files in `docs/`.
- Milestones 8 and 9 (ledger, reservations, fulfillment) get an extra human review before the
  next milestone starts.
- If something is unclear, list it as an open question in the PR. Do not guess business rules.

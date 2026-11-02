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
| M2 Product model | Done, **open fix list in §10** |
| M3 Scanning, offline queue, backups | Not started — begin only after §10 is complete and reviewed |
| M4–M11 | Not started |

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
- Business semantics (stock rules, reservation policies, ownership, pricing boundaries,
  lifecycle states, permissions, AI rules) may not be changed on your own. Write an ADR in
  `docs/adr/` marked **Proposed** and stop that item until it is approved.
  Implementation details (naming, structure, indexes, components) are yours to improve.

## 9. Errata (override the documents above)

- **E1 — Internal SKU format.** The specification's example `AGT-000184` is only an example.
  Internal SKUs and printed labels must not contain a company abbreviation. Use the format
  `KH-000001`, sequence starting at 1. See F2.

## 10. Open fix list after M2 (do this before M3)

Work on branch `m2-fixes`. One commit per item, message prefixed with the item ID.
Each item needs tests. New schema changes go into new migrations only.

**F1 — Enforce the SKU lifecycle (critical).**
Today `transitionSkuToReady` moves a SKU from any state, including INTAKE with LOW confidence
or ARCHIVED, and `createSkuDraft` accepts any initial state and confidence from input.
- Implement an explicit transition table in `packages/products` (spec §15.1); reject any
  transition not in it.
- `createSkuDraft` always creates `INTAKE` with confidence `LOW`; callers cannot set either.
- READY requires: Product Type assigned; confidence `HIGH`, or `MEDIUM` explicitly confirmed by
  an admin; verified brand and model; generated display names; at least one active
  accounting mapping. `ARCHIVED` is terminal.
- Tests: every forbidden transition is rejected; READY rejected for each missing precondition.

**F2 — Neutral internal SKU (critical, before any label is printed).**
- New migration: restart `internal_sku_seq` at 1.
- Format `KH-` + 6 digits. Update allocation, seed data, label rendering and tests.
- Grep the repository for `AGT-` and remove every remaining use.

**F3 — Slugs for variants.**
SKUs of the same family share brand and model, so the second one gets a meaningless `-2`.
Include the English key differentiator in the slug whenever the family has more than one SKU
(or always, if simpler). The auto-suffix stays only as a last resort.

**F4 — Status and provenance for universal fields.**
`power_kw`, `weight_kg` and the other universal columns are bare numbers, so an unverified
value looks the same as a verified one.
- Store per-field metadata for universal fields using the same entry schema as type
  attributes (`status`, `sourceType`, `evidenceId`), e.g. `universal_field_meta_json`.
- `VERIFIED` requires `evidenceId` or `verifiedBy` (user id) for both universal and type
  attributes. Until the evidence table exists (M5), `verifiedBy` is enough.

**F5 — Identifiers.**
- Normalize GTIN/EAN/UPC to GTIN-14 on attach and on scan lookup; validate the check digit
  (invalid check digit → validation error, manual entry may override with a reason).
- `INTERNAL_SKU` and `INTERNAL_QR` are created only by the system, never through the attach
  API; add a partial unique index on `(identifier_type, value)` for these two types.
- Serialize collision detection with `pg_advisory_xact_lock(hashtext(type || ':' || value))`.
- Scan lookup excludes ARCHIVED SKUs by default.

**F6 — Test isolation.**
On a fresh database the first `pnpm test` run fails because `products.test.ts` relies on
another test file having migrated first. Add a Vitest `globalSetup` that migrates and seeds once.
Acceptance: fresh database → `pnpm test` passes twice in a row.

**F7 — Smaller items.**
- New migration: revoke DELETE on `skus`, `product_families` and `accounting_mappings` from
  `hub_app` (archive or deactivate instead).
- Clear `has_collision` when a collision is resolved; record the resolution in audit.
- Optional, low priority: rename the dev database and container from `agrotrade_hub` /
  `agrotrade-hub-postgres` to `khidi` names (requires a dev DB reset; document it).

When F1–F7 are done: all checks in §4 green, update §3, open a PR, and stop.
Do not start M3 in the same branch.

## 11. Working agreement

- One milestone (or fix list) per branch. Small commits. No unrelated refactors.
- At the end of each milestone: run §4 from a fresh database, update §3, and write a short
  summary in the PR listing every deviation from the documents and every ADR created.
- Milestones 8 and 9 (ledger, reservations, fulfillment) get an extra human review before the
  next milestone starts.
- If something is unclear, list it as an open question in the PR. Do not guess business rules.

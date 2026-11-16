# Catalog review workspace — implementation plan

Base: `318714b` (main). Working branch: `feat/catalog-review-workspace`.

## Goal

Help Lika make informed editorial decisions with little repeated work. Show what improved,
what was lost, and what remains unknown. A completed editorial pass is not verified product
data or permission to publish. Keep the existing Hub, authentication and append-only audit.

## Phase 1 — bounded interface improvements

- Use the same name/WordPress-ID, category and status predicate in the queue and next-product
  navigation, including wraparound. Never leave the active search silently.
- Compare the complete original and proposed text. Mark removals and additions independently;
  preserve whitespace, Georgian, model strings and numbers exactly. A bounded comparison falls
  back to whole blocks for very large input. Plain reading remains available.
- Present imported observation/rationale as expandable source notes. Some text proposals have
  photo-only observations; do not rewrite that immutable provenance or claim it diagnoses the
  current field. The direct text comparison becomes the primary review aid.
- Separate photo inspection from main-photo selection. Provide a modal viewer, previous/next,
  zoom, Escape/close and focus return. Use the existing authorized preview endpoint. State
  that previews are at most 960 px; show original archive dimensions separately.
- Explain low-resolution/brightness flags as automatic review hints, not verification failures.
- Show a product thumbnail, handle blank titles and label absent proposals/blank source text
  honestly. Keep field actions, history, revisions, checkpoint counts and publishing unchanged.
- Keep mobile sections in a single scrollable row and use readable action targets. No new
  dependency, migration, external AI request or public media URL.

### Acceptance

1. Search `FT51975`: both visible results remain the only eligible next products; no jump to
   an unrelated abrasive disk. Search by `#8138`, category and deferred filter also works.
2. A changed `7` → `9` and omitted `112 kg` are visible; reconstructing each side from the
   comparison yields its exact input. Literal HTML stays text.
3. A 450 × 450 source shows its resolution hint; inspecting it does not change the selected
   main photo. Closing the viewer restores focus. Radio selection still supplies the same ID
   to the unchanged decision API.
4. Missing photo offers deferral. A blank field without a proposal says text is missing, not
   unchanged; no new write path is offered.
5. Check desktop and mobile comparison/photo screens, keyboard dialog behavior and horizontal
   overflow. Exercise local presentation fixtures only; do not write production decisions.
6. Run focused navigation/diff regression tests, typecheck, boundaries, lint and build. Record
   limits of visual/real-device validation rather than treating a fixture as full end-to-end QA.

### Verification record — 2026-11-16

| Check | Result |
| --- | --- |
| Pinned install (`pnpm@12.16.1`, frozen lockfile) | Passed; no manifest/lockfile changes |
| `corepack pnpm typecheck` | Passed |
| `corepack pnpm check:boundaries` | Passed |
| `corepack pnpm lint` | Passed |
| Focused navigation and comparison tests | 16 passed across 2 files |
| `corepack pnpm build` | Passed, Next.js 16.4.3 |
| `git diff --check` | Passed |
| Browser, keyboard and real-device walkthrough | Pending; browser security policy rejected the standalone fixture's `data:` URL |
| Full PostgreSQL-backed suite | Not run; PostgreSQL/Docker unavailable in this workspace |

The focused tests used a temporary Vitest config with only the two pure utility test files
and no database global setup. Production test configuration and database safety guards were
not changed. No authorization, persistence, migrations or decision semantics changed. The
compiled UI has not been visually verified; keep the PR in draft until the walkthrough above.

## Phase 2 — decision model and reviewer workflow

See [Proposed ADR-016](../adr/ADR-016-catalog-review-candidates-and-completion.md). Resolve the
candidate/version contract first; then add missing-field editing, explicit deferred work,
personal progress for an administrator acting as a reviewer, and result summaries. Add
server-backed draft recovery scoped to actor/product/field/base revision. Drafts never submit
automatically; a conflicting revision requires comparison. Decide retention and logout behavior
before storing private content persistently on a shared device.

Improve the initial 20-item guided sequence using useful complete examples, with missing-photo,
missing-name and suspected-duplicate cases later. Keep the original imported rank as provenance;
any new working order must be explicit and must not rewrite old reports. Add a focused review
shell for ADMIN without granting or removing permissions.

## Phase 3 — quality assistance and AI experiment

After the version model is accepted, prototype contextual actions: simplify text, shorten a
description and identify differences from supplied evidence. Each output must be a new candidate
with its input sources, changed claims and unresolved questions. Deterministic model/number checks
must reject unsupported changes; no auto-approval, identity verification or publication. Keep
INTERNAL_ONLY evidence out of providers under ADR-010. Choose provider, budget, allowed source
classes and retention in a separate approved AI decision before integration.

Evaluate on a fixed representative set including missing evidence, conflicting specifications,
duplicates and low-quality photos. Measure unsupported-claim rate, useful-edit acceptance,
review time and follow-up burden. Compare against the improved manual flow first.

## Later operational hardening

Move image preparation outside long database transactions, with a manifest/asset staging record
and retry/reconciliation contract. Preserve verified originals and immutable hashes. This needs
fault-injection tests before changing the existing import path; no re-import is needed for Phase 1.

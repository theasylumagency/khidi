# ADR-016 — Catalog review candidates and editorial completion

- Status: **Proposed — not approved or implemented**
- Date: 2026-11-16
- Scope: legacy catalog editorial review only
- References: catalog-review-pilot.md; ADR-001; ADR-010; AGENTS.md §8

## Problem

The pilot has one immutable proposal per product/field. A missing proposal cannot be edited.
An EDIT decision contains text, while a later APPROVE points only at the imported proposal;
the effective selected version is ambiguous. First-pass counts include deferrals and say nothing
about missing fields. ADMIN can review but does not receive personal reviewer checkpoints.

## Proposed decisions for owner review

1. **Explicit candidates.** Give each NAME/SHORT/FULL/PHOTO field a review item independent of
   whether the import supplied a proposal. An import, human edit or future AI suggestion creates
   an immutable candidate with author, source and parent candidate. A decision selects/rejects
   a specific candidate; the UI shows that exact text/photo. Editing then approving cannot
   silently select the original import. Keep existing imported proposals and decisions intact.

2. **Two independent indicators.** Preserve historical first-pass reports exactly. Show first-pass
   progress separately from unresolved work. New editorial completion requires an explicit
   accepted candidate or an explicit allowed omission for each applicable field, and no unresolved
   blocking editorial issue. Deferral and rejection without replacement do not imply readiness.
   Suggested required content: name, short description, full description and main photo. The owner
   must confirm which descriptions may be intentionally omitted before introducing this gate.

3. **Reviewer participation separate from role.** Preserve existing access checks. An ADMIN may
   explicitly participate in a batch, retaining all admin rights but receiving their own progress
   and report. Assignment remains mandatory for CATALOG_REVIEWER. Admin aggregate oversight and
   personal decisions must have distinct projections; do not silently reinterpret prior decisions.

4. **Follow-up issues.** Missing photos, unclear identity/specifications and suspected duplicates
   create explicit editorial issues with a reason and resolution history. Resolving an editorial
   issue never verifies an evidence claim, merges SKUs, moves READY or publishes a product.

## Migration and compatibility proposal

Add tables in a new migration for review items, candidates, selected-candidate decisions and
issues. Existing tables remain append-only. Map an imported proposal to an initial candidate;
map EDIT to a candidate containing its exact text. Do not guess what a historical APPROVE after
EDIT intended: display the recorded action and require explicit selection when ambiguous.
Old checkpoint JSON remains frozen. Define the mapping/idempotency contract and rollback path
before implementation. All writes retain revision conflict checks and atomic audit/outbox.

## Out of scope

Publishing, canonical product identity, stock, pricing, automatic SKU merging and live AI.
No production migration, role change or re-import is authorized by this Proposed ADR.

## Acceptance after approval

- Editing a previously missing field creates a review item/candidate without modifying baseline.
- Approve/reject always references the displayed candidate; old and new history is inspectable.
- Conflicting edits/decisions fail closed, retain the draft and show the new base revision.
- Personal progress is actor-scoped; assignment and photo/report access stay isolated.
- Existing reports remain byte-for-byte stable; completion cannot conceal deferred/required work.
- Canonical products, READY/publishing and inventory are unchanged by every review action.

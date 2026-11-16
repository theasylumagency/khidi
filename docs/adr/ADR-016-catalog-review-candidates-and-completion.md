# ADR-016 — Catalog review candidates and editorial completion

- Status: **Part A accepted; Parts B–D remain Proposed**
- Date: 2026-11-16
- Scope: legacy catalog editorial review only
- References: catalog-review-pilot.md; ADR-001; ADR-010; AGENTS.md §8

## Problem

The pilot has one immutable proposal per product/field. A missing proposal cannot be edited.
An EDIT decision contains text, while a later APPROVE points only at the imported proposal;
the effective selected version is ambiguous. First-pass counts include deferrals and say nothing
about missing fields. ADMIN can review but does not receive personal reviewer checkpoints.

## Part A — accepted: missing text fields and exact approval

Owner approved filling absent text fields and approving the exact edited version on 2026-11-16.
This acceptance does not include new completion gates, reviewer roles, persistent drafts or AI.

- An assigned reviewer or ADMIN can fill NAME/SHORT/FULL even when the import supplied no
  proposal. The first save appends a MANUAL proposal and an EDIT decision in one transaction.
  The original baseline remains untouched. Existing proposals are edited through decisions.
- The imported proposal and existing immutable EDIT decisions serve as text-version identities.
  A separate candidate table is unnecessary for this bounded step. A manual proposal's initial
  text is carried by its first EDIT decision; every subsequent edit is another immutable version.
- A new text APPROVE explicitly names either the imported proposal or a same-field EDIT ID.
  The server copies that source's exact text into `approved_text`; it never accepts approval
  text from the request. `approved_text_edit_id` records an edit source. PostgreSQL verifies
  source equality and the same-proposal relationship. Later edits cannot change an approval.
- Saving an edit keeps the reviewer on the field to inspect and approve it. They may choose
  an earlier visible version. History and newly created reports show the approved text.
- Missing-field creation serializes by product/field and rejects a second author with CONFLICT.
  All decisions retain global proposal revisions, actor/batch locks, idempotency and atomic
  audit/outbox. Access continues to use the existing role and assignment rules.
- Manual proposals remain distinguishable from imports, including creator attribution. Runtime
  insertion of IMPORT proposals is rejected. No new access to canonical products is introduced.
- Old decisions and reports are not rewritten or reinterpreted. An old APPROVE without a text
  snapshot is shown as having no recorded version; the reviewer can explicitly approve again.
- Review display/search can use the current actor's saved/approved name (latest decision for
  ADMIN), with baseline fallback. This is a private review projection, not canonical identity.

Migration `0059_catalog_review_text_versions.sql` adds the provenance and snapshot columns,
constraints and insertion guards. It does not backfill historical approvals. New clients must
send a text-version reference; old text-approval requests fail closed. Deploy the new schema
and application together with Hub stopped. Rolling back to the old binary leaves new tables/
columns intact but cannot support its old text-approval writes: use a forward fix, not a down
migration. Photo decisions are unchanged.

Part A preserves the existing first-pass definition: EDIT and DEFER count as decisions, and
reports already created stay frozen. It does not claim that first-pass completion means ready
to publish. Optional new fields become review items when a person first saves them.

## Parts B–D — proposed, not approved or implemented

Future generalization of Part A: give each NAME/SHORT/FULL/PHOTO field a review item independent of
   whether the import supplied a proposal. An import, human edit or future AI suggestion creates
   an immutable candidate with author, source and parent candidate. A decision selects/rejects
   a specific candidate; the UI shows that exact text/photo. Editing then approving cannot
   silently select the original import. Keep existing imported proposals and decisions intact.

**Part B — Two independent indicators.** Preserve historical first-pass reports exactly. Show first-pass
   progress separately from unresolved work. New editorial completion requires an explicit
   accepted candidate or an explicit allowed omission for each applicable field, and no unresolved
   blocking editorial issue. Deferral and rejection without replacement do not imply readiness.
   Suggested required content: name, short description, full description and main photo. The owner
   must confirm which descriptions may be intentionally omitted before introducing this gate.

**Part C — Reviewer participation separate from role.** Preserve existing access checks. An ADMIN may
   explicitly participate in a batch, retaining all admin rights but receiving their own progress
   and report. Assignment remains mandatory for CATALOG_REVIEWER. Admin aggregate oversight and
   personal decisions must have distinct projections; do not silently reinterpret prior decisions.

**Part D — Follow-up issues.** Missing photos, unclear identity/specifications and suspected duplicates
   create explicit editorial issues with a reason and resolution history. Resolving an editorial
   issue never verifies an evidence claim, merges SKUs, moves READY or publishes a product.

## Future migration and compatibility proposal (Parts B–D)

Add tables in a new migration for review items, candidates, selected-candidate decisions and
issues. Existing tables remain append-only. Map an imported proposal to an initial candidate;
map EDIT to a candidate containing its exact text. Do not guess what a historical APPROVE after
EDIT intended: display the recorded action and require explicit selection when ambiguous.
Old checkpoint JSON remains frozen. Define the mapping/idempotency contract and rollback path
before implementation. All writes retain revision conflict checks and atomic audit/outbox.

## Out of scope

Publishing, canonical product identity, stock, pricing, automatic SKU merging and live AI.
Parts B–D authorize no production migration, role change or re-import. Part A requires only
the additive migration described above and never re-imports the existing batch.

## Acceptance

- Editing a previously missing field creates a review item/candidate without modifying baseline.
- Part A approvals always reference the displayed candidate; old and new history is inspectable.
- Candidate-specific rejection, new completion gates and personal ADMIN reports remain Proposed.
- Conflicting edits/decisions fail closed. Part A keeps unsaved text in the open form and asks
  the reviewer to copy it before refreshing to inspect the new revision. Persistent recovery
  and a conflict-comparison interface remain future work.
- Personal progress is actor-scoped; assignment and photo/report access stay isolated.
- Existing reports remain byte-for-byte stable; completion cannot conceal deferred/required work.
- Canonical products, READY/publishing and inventory are unchanged by every review action.

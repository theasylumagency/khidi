# SKU split and merge evidence

Base `bbe0fde350e62bfd40c915e1a1c6182a1d1fad39`, after M6 PR #11.
Branch `feat/sku-split-merge-evidence`.
Specifications are ADR-011 Part A and ADR-012. ADR-011 Part B remains Proposed.

## Steps

1. Extend the immutable M5 comparison record with MATCHES and DIFFERS, acknowledgement
   metadata and evidence intake provenance. Add split lineage and explicit asset attributions.
2. Implement the pre-inventory split, category redirects, candidate basis and shared accounting
   confirmation. Extend the existing label review path and expose resolution counts.
3. Require an accepted sameness inspection for merges. Resolve acknowledged fields separately
   for each original side and keep them unpublished until the unknown side is verified.
4. Add the admin actions and regression tests listed in both ADRs. Run focused package checks
   during work and one full suite on a fresh local test database at completion.
5. Stabilize acceptance fixtures exposed by the final suite, separately from domain changes:
   integration expiry uses the application clock with an expired margin (exact boundary unit
   tests remain); the locale-projection fixture uses a unique decimal model suffix.

## Operations

Migrations 0024–0029 are new; no earlier migration changed. The inventory precondition checks the inventory,
reservation and fulfillment relations named in the implementation plan when those relations
exist. M8 must use the same catalog locking and archived-SKU checks for its writes.

## Implemented behavior

- One immutable comparison structure records DIFFERS and MATCHES. Non-observable split
  candidates use a pending, support-linked staff comparison; a physical inspection can
  verify only observable readings. Evidence retains its original ownership and immutability.
- Splits archive the source, disable its listings, retain its slug as a category redirect,
  and keep intake, image and evidence history. New targets inherit the Product Type and
  Product Family. Optional text copies are MANUAL and unapproved. Explicit, audited
  attributions determine which original assets count for each target.
- Split labels, including merge predecessors, enter SPLIT_INTERNAL_LABEL review. Resolution
  to an active split descendant requires a replacement label. The list shows distinct
  printed-label intake records and resolved review records. Since a SKU code is shared by
  its physical units, these are record counts, not an inferred count of individually
  identified remaining units.
- Merges require an accepted MATCHES inspection and currently verified photos of both
  products. Known differences, missing observable readings and unacknowledged unknowns block.
  The M6 READY/approved Georgian survivor guard remains in force.
- Each acknowledged field stores the unknown side, both original lineages and the known
  baseline value, if any. The field remains unpublished until matching evidence from the
  unknown side verifies it. New evidence can identify that side through an old-label intake;
  the admin evidence form allows choosing the unit's intake. A contradictory verified value
  produces CONFLICT and ACTION_REQUIRED, without changing READY or the canonical slug.
- Shared active accounting items require explicit ADMIN confirmation. The mapping flag is
  computed for all affected mappings; its confirmation is audited and checked in PostgreSQL.
  M8 reports can use this mapping flag.
- API corrections and accounting confirmations require ADMIN, same-origin requests and
  idempotency keys. Writes, audits and outbox events share the supplied transaction.

## ADR test coverage

- packages/products/src/split.test.ts: inactive/merged sources, inventory refusal,
  equal basis, support-required candidates (including rejected historical support),
  unverified basis/READY blocking, archive/listings/slug, family, unapproved content copies,
  evidence/image attribution, database guards, accounting consent and audits.
- packages/scanning/src/split-labels.test.ts: split labels, replacement resolution,
  original intake retention, merge-chain terminal splits, counters and resolution audit.
- packages/media/src/public-media.test.ts: real derivative publication for an attributed
  split image, exclusion of other source images, original ownership and withdrawal, including
  invalidation through a merge followed by a split.
- packages/evidence/src/comparison.test.ts: one shared structure; missing/differing
  observable MATCHES readings refused.
- packages/products/src/merge-evidence.test.ts: mandatory accepted inspection, barcode/
  staff insufficiency, missing acknowledgement, hidden known-side values, both unknown
  orientations, original evidence and old-label proofs, flag clearing/audit, differing
  brand/model, explicit Medium field confirmation and later contradictory evidence with notification.
- apps/hub/src/app/api/products/corrections/corrections.test.ts: authentication, role,
  origin, split/attribution replay and changed-payload rejection.
- Existing M6 scanning, approved-content and image-lineage regressions now supply accepted
  sameness inspections and retain their original checks.

## Verification

Focused checks passed during implementation. The final fresh-database run on the local
PostgreSQL 18.4 database khidi_split_final_test passed 387/387 tests across 65 files, with no
skips. Real MinIO integration ran against a disposable local instance on port 9550, using
dedicated khidi-test-* buckets. No shared database or production environment was used.

Final commands passed: pnpm typecheck, pnpm lint (including check:boundaries), and pnpm build.
The full suite was run through pnpm test --reporter=dot. Node.js was 24.19.0.

The initial acceptance attempts exposed clock-sensitive idle-expiry fixtures and a random
hex model suffix interpreted as an electrical unit. Assertions were retained; only fixture
timestamps and the unique suffix representation changed. No authentication runtime or
content-validation policy changed. These failures required acceptance retries.

Follow-up outside these ADRs: technical-number parsing can treat a digit-plus-A fragment of
a verified model code as amperage. The locale-suspension test now isolates its own concern
with a decimal suffix; a separate validator regression should address that model/unit ambiguity.

## Owner review checklist

1. Compare two photos in evidence, choose MATCHES, enter matching observable readings and
   reasons only for undetermined distinguishing fields; accept, then select it in Merge.
2. Split a draft into two wheel variants, selecting each unit's photo; verify source links,
   target fields, unapproved copied text and the attribution form.
3. Scan an old split label, choose its actual variant in review and print its replacement.
4. On a survivor with an acknowledged rating, attach matching evidence to an intake scanned
   through the unknown side's old label. Confirm the flag clears only after acceptance.

No deployment or merge is included. ADR-011 Part B remains Proposed; no inventory movement,
reservation or fulfillment behavior has been implemented.

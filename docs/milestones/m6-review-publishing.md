# M6 — Review, canonical content and publishing

## Gap inventory

| Requirement | Existing base | Extension |
| --- | --- | --- |
| Versioned content and approval by locale | Mutable KA/EN columns on `skus` | Add immutable content versions, approval pointers and an unapproved migration of historical text. |
| Verified factual copy | Product naming helpers and `sku_field_provenance` | Generate and validate content from verified facts. Store the facts the version actually uses and detect later changes in evidence recomputation. |
| Manual and AI proposals | M5 synthetic AI job queue | Add the content editor, deterministic proposals and synthetic AI proposals with explicit human approval. |
| READY and slugs | `transitionSkuToReady` and append-only slug history | Require valid approved KA content and preserve existing READY SKUs and their slugs during migration. |
| Review workspace | Products table, SKU detail, accounting and evidence actions | Show review flags, locale approvals, missing EN and per-storefront publication and sale blockers. |
| Publishing | `evaluateStorefrontSellability` and verified facts/media helpers | Separate locale publication from sale eligibility. Project approved content and verified structured facts. Keep price and allocation blockers explicit. |
| Merge and redirects | Archive lifecycle, identifier resolution, immutable evidence and slug history | Add audited SKU lineage, listing selection and scan/slug redirects while retaining the original records. |
| Split | Inventory ownership and accounting rules are pending | Record the open decisions in a Proposed ADR. |

## Implementation

- `0022_canonical_content.sql` adds immutable versions and a current approval per locale. It
  imports historical text as unapproved, retains existing READY states and slugs, and queues
  a review notification. New READY transitions require valid approved Georgian content and
  continue to enforce the ADR-010 identity and accounting checks.
- The SKU workspace displays field provenance, evidence, photos, accounting, lifecycle
  actions, content versions and approval status. The catalog can filter READY products
  without approved English content. Search uses type aliases and Georgian transliterations.
  An incorrect SKU can be archived with a reason through the existing lifecycle action.
- Admins can edit and approve versions manually or start from deterministic generation.
  The optional synthetic provider saves separate drafts for human review. The reviewer
  evaluates language and style. The validator checks catalog brand mentions, model-like
  codes, numbers with recognized technical terms, and confidential phrases. Technical
  synonyms are editable in Settings. Confidentiality uses catalog accounting records,
  supplier evidence and Hub hosts, along with internal SKU and currency patterns.
- Publication readiness and sale eligibility are evaluated per storefront and locale. Only
  approved text for the requested locale and public VERIFIED fields appear in the projection.
  A conflict in a fact the approved text uses suspends that locale and alerts the admin.
  Other fact changes retain the approved text and flag it for review. An identity conflict
  suspends every locale. Legacy LOW identity can publish once the other checks pass.
- Prices and allocation owners remain unmet until M7 and M8 supply the data. Publish-ready
  projections therefore report `sellable: false` with reasons. Storefront delivery and
  redirect transport remain part of the later API milestone.
- `0023_sku_merge_lineage.sql` adds SKU lineage and the scanned SKU reference. The survivor
  can use its predecessors' identifiers, evidence and verified images while original records
  retain their owners. Shared listings on two READY SKUs require an explicit choice.
  ADR-005 documents scan and archive behavior. ADR-011 records the outstanding decisions
  for splits, which are deferred.

## Checks

Automated coverage includes immutable version rows, unsupported brands and numbers, the
Georgian READY gate, English approval states, fact changes, locale-specific conflicts,
projection confidentiality, merged labels and slug resolution, cycle and archive fallback,
and publication of inherited images.

- The validator review fix passed all 372 tests across 60 files on a fresh local PostgreSQL 18
  `_test` database with MinIO. Typecheck, lint, dependency boundaries and build passed.
  A session timing assertion failed on the initial run, then passed in isolation and in the full retry.
- A final merge review included inherited reference photos in identity recomputation.
  Focused evidence, products, media and scanning tests and the affected package typechecks passed.
- An upgrade from migrations 0001–0021 with a legacy READY fixture preserved its slug and
  state, imported its text without approval and raised the review notification. Reapplying
  migrations reported no pending changes.

## Review on an isolated environment

- Approve Georgian content for a draft with verified facts, move it to READY and check each
  storefront's publication and sale reasons. Approve English separately and confirm both
  versions appear in the review panel.
- Introduce a conflict in one locale's text and confirm the review notification. Resolve it or
  approve a version without that fact. Confirm the READY state and slug were preserved.
- Use duplicate fixtures with the same storefront listing, select the survivor's listing,
  and scan a printed label for the archived SKU. Check both SKU references and the old slug.

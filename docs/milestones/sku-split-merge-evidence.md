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

## Operations

Migrations 0024 and 0025 are new. The inventory precondition checks the inventory,
reservation and fulfillment relations named in the implementation plan when those relations
exist. M8 must use the same catalog locking and archived-SKU checks for its writes.

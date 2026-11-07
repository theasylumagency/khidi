# ADR-011: SKU split — pre-inventory split now, inventory split later

- **Status:** Part A **Accepted** · Part B **Proposed** (deferred to M8)
- **Date:** 2026-11-08
- **Decided by:** project owner
- **References:** ADR-005 (label scans and review), ADR-010 (§6 variant safety),
  M6 merge lineage (`merged_into_sku_id`, migration 0023)

## Context

During review a SKU can turn out to represent two or more physically different variants
(for example a motoblock recorded once, later found to exist with rubber and with iron wheels).
The M6 proposal deferred every split because a split changes what physical labels, accounting
records and future stock represent.

Today no stock pools, allocations, reservations or fulfillment exist (they arrive in M8–M9), and
ADR-005 already provides a review path with replacement labels. A split is therefore cheapest
and safest now, while the pilot catalog is being built — which is also when such errors will be
discovered. Once inventory exists, a split also has to move stock and open reservations; that is
a separate decision.

## Part A — Pre-inventory split (Accepted)

### Precondition

The source SKU has no inventory records of any kind (stock pools, allocations, reservations,
fulfillment lines, ledger rows). Before M8 this is always true. From M8 on, the split service
checks it and refuses with a reference to Part B. A SKU that is itself archived or merged away
cannot be split.

### Operation

One transaction, ADMIN only, mandatory reason, fully audited (`SKU_SPLIT`):

1. **Targets.** The admin defines two or more target SKUs: new drafts (`INTAKE`, `LOW`,
   `HOUSE_DEFINED`, same Product Type and Product Family) or existing non-archived SKUs of the
   same Product Type.
2. **Distinguishing basis.** The split records, for each target, at least one distinguishing or
   observable attribute with a value that differs between the targets (the same structure as
   the M5 structured comparison inspection). How each value is stored depends on the attribute:
   - **Observable attribute** (e.g. wheel type): recorded through the comparison inspection
     with photos and follows ADR-010 normally — it can become VERIFIED on acceptance.
   - **Non-observable attribute** (e.g. power): an inspection cannot verify it (ADR-010 §2).
     The value is stored as an **unverified candidate** on the target. It must reference at
     least one existing evidence item that supports it, in any status (for example a PENDING
     plate photo, a carton photo, or a staff statement); a value typed without any supporting
     evidence is refused. It becomes VERIFIED only through the normal ADR-010 rules.
   A target whose split basis consists only of unverified candidates is flagged
   "split basis unverified" in review. No extra block is needed: under the §6 uniqueness check
   such targets remain indistinguishable, so they cannot become READY until a differing value
   is verified (or an observable difference is recorded).
3. **Source.** The source SKU becomes `ARCHIVED`. A new table `sku_split_targets
   (source_sku_id, target_sku_id, created_by, created_at)` records the lineage. A SKU is never
   both merged and split: `merged_into_sku_id` and split lineage are mutually exclusive.
4. **Listings** of the source are disabled. **Content** is not transferred as approved; the admin
   may copy it into a target as an unapproved `MANUAL` version.
5. **Slug.** The source slug is not given to any target. It stays in slug history and is marked
   to redirect to the Product Type's category page, because no single target is its successor.
6. **No undo.** A wrong split is corrected with a merge.

### History stays where it is

Evidence, images and intakes are not moved or rewritten (M5 immutability and M6 merge rules).
Instead the admin **attributes** them to a target:

- `evidence_attributions (evidence_id, target_sku_id, attributed_by, attributed_at, reason)` and
  the equivalent for images. Attribution is an audited admin action.
- An attributed ACCEPTED evidence item counts for the target's field resolution exactly as if
  it were the target's own; unattributed source evidence counts for no target.
- An attributed image may be verified and published for the target (extend the M6 image
  publication lineage trigger to split attributions).
- Intakes keep their original `matched_sku_id`; their history is not changed.

### Physical labels

- Scanning a `KH-` label of a split source never resolves automatically: it goes to Class A
  review with the new reason `SPLIT_INTERNAL_LABEL`, listing the target SKUs as candidates.
- The admin resolves with the existing ADR-005 "Link to an existing SKU" resolution, choosing
  the correct target; a replacement label is queued for printing.
- The review list shows, per split source, how many of its labels were printed and how many
  have been resolved, so the warehouse knows how many physical units still carry the old label.
- ADR-005 is amended with this reason. The merge exception (merged labels resolve to the
  survivor) is unchanged; a merge chain that ends in a split source goes to review.

### Accounting mappings

Mappings are not copied. The admin enters mappings for each target. If the accounting system
keeps both variants under one item, mapping the same accounting item to several targets is
allowed only with explicit confirmation; such SKUs are flagged "shared accounting item" in
review and in the M8 reports.

### Tests

- split refused for an archived or merged source, and (from M8) for a source with inventory;
- targets without a differing attribute value are refused;
- a non-observable split value without any supporting evidence item is refused; with a
  supporting item it is stored as an unverified candidate, the target is flagged
  "split basis unverified", and it cannot become READY until the value is verified;
- source archived, listings disabled, slug kept in history with a category redirect;
- unattributed evidence does not count for any target; attributed accepted evidence does;
- an attributed image can be published for its target; an unattributed one cannot;
- a split source label goes to review with `SPLIT_INTERNAL_LABEL` and resolves to the chosen
  target with a replacement label; label resolution counters are correct;
- merge chain ending in a split source goes to review;
- shared accounting item requires confirmation and is flagged;
- full audit trail of the split, attributions and resolutions.

## Part B — Split with inventory (Proposed, deferred to M8)

Once a SKU has stock, a split must also decide:

- which physical units belong to which target, who confirms it, and how stock moves between
  pools and allocations in the ledger (new movement types or a documented composition of
  existing ones);
- what happens to open reservations and commitments of the source;
- how sales reports present history before and after the split, per legal entity.

Until Part B is accepted, the split service refuses any SKU with inventory records.

## Consequences

- Variant errors found during the pilot can be fixed immediately, with full traceability.
- Physical relabelling uses the existing review and replacement-label workflow.
- New schema in a new migration: `sku_split_targets`, `evidence_attributions`, image
  attributions, the `SPLIT_INTERNAL_LABEL` review reason, slug redirect target type.

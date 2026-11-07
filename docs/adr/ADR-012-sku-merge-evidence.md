# ADR-012: Evidence required to merge SKUs

- **Status:** Accepted
- **Date:** 2026-11-08
- **Decided by:** project owner
- **References:** ADR-010 (§2 evidence, §6 variant safety), ADR-011 (split), M5 structured
  comparison inspections, M6 merge lineage

## Context

M6 lets an admin merge two SKUs after explicitly confirming that they describe the same physical
variant, with the basis recorded in the audit. Known verified differences and identity conflicts
already block a merge.

The dangerous error is merging two different variants (for example 7 HP and 9 HP that look the
same). ADR-010 treats unknown attributes as compatible with anything, so two SKUs can be
"indistinguishable" simply because nothing is known about one of them. A confirmation with a free
note is therefore not enough. A merge is the mirror image of a split (ADR-011) and of the
structured comparison that separates SKUs (M5): it needs positive, structured evidence of
sameness.

## Decision

A merge requires a **sameness record**: an `ADMIN_PHYSICAL_INSPECTION` with
`comparison_sku_id`, in the same structure as the M5 comparison inspection, but recording that
values **match**:

1. **Photos of both products**, ACCEPTED, showing them side by side or each from the same angle.
2. **Every observable distinguishing attribute** of the Product Type is recorded for both
   products with the same value. Observable attributes are those an inspection may verify under
   ADR-010 (e.g. fuel type, wheel type, number of gears).
3. **Every non-observable distinguishing attribute** (e.g. power, displacement) must be either
   VERIFIED with the same value on both SKUs, or, if unknown on either side, explicitly
   acknowledged by the admin as "not determinable for both — treated as the same product", with
   a mandatory reason.
4. Brand and model, where VERIFIED on both, must be equal.

The values recorded under 2 become ordinary evidence claims on both SKUs.

**Never sufficient on their own:** a shared barcode or other external identifier, AI photo
similarity, a staff statement, or a free-text note.

**Acknowledged unknowns stay visible.** If a merge used acknowledgement 3, the surviving SKU
carries a flag "merged with undetermined: <attributes>" in review. Each flagged attribute
remembers which side was unknown (the survivor's own lineage or the merged-away SKU's lineage).

- **Publishing:** a flagged attribute is not published, even if it is VERIFIED from the other
  side. Example: A has 7 HP VERIFIED, B's power was unknown and acknowledged; after the merge
  the survivor does not publish 7 HP, because units that came from B may differ.
- **Clearing the flag:** only when the same value becomes VERIFIED from evidence belonging to
  the previously unknown side — evidence originally recorded on that SKU, or new evidence
  captured from a unit identified through that side (an intake whose `scanned_sku_id` is the
  merged-away SKU, i.e. a unit still carrying its old label). New evidence from the other side
  never clears it. Clearing is audited and the attribute becomes publishable.
- **Contradiction:** a different VERIFIED value from the previously unknown side raises a
  CONFLICT and an ACTION_REQUIRED notification; the correction is a split (ADR-011).

The existing M6 rules remain: identity conflicts and known verified differences block a merge; a
source with a canonical slug requires a READY survivor with current approved Georgian content
after combining the evidence; the whole operation is atomic and audited.

## Consequences

- Duplicate drafts (the same unit scanned twice) are merged with one inspection and two photos.
- Visually identical but different variants cannot be merged silently; the admin either proves
  sameness or explicitly accepts the risk for named attributes, and that acceptance is visible
  and reversible through a split.
- New schema in a new migration: the acknowledgement records and the survivor flag.

## Tests

- merge refused without a sameness record;
- refused when an observable distinguishing attribute differs or is missing for one product;
- refused when a non-observable distinguishing attribute is unknown and not acknowledged;
- allowed with acknowledgement; the survivor carries the flag and the attribute stays unpublished,
  even when it is VERIFIED from the other side;
- the flag clears only on a matching VERIFIED value from the previously unknown side (its own
  evidence or a unit scanned through its old label); evidence from the other side never clears it;
- refused on differing VERIFIED brand or model;
- shared barcode, AI similarity or staff statement alone do not satisfy the rule;
- a later contradicting VERIFIED value from the previously unknown side raises CONFLICT and
  notification.

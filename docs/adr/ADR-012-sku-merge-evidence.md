# ADR-012 — Evidence required for SKU identity confirmation

Status **Proposed**

## Context

ADR-010 §6 leaves the same-product decision to an admin. M6 records the admin's
explicit confirmation of the same physical variant and the basis for that decision
in the merge audit. Known verified differences and identity conflicts block the
merge. A source with a canonical slug requires a READY survivor with current
approved Georgian content, including after combining the evidence.

Indistinguishability under ADR-010 includes unknown attributes. A matching brand,
model or external identifier can still be shared by different physical variants.

## Proposal for owner review

Require the admin to reference recorded positive evidence in addition to confirming
identity. For manufacturer-identified SKUs, consider verified brand and model
together with verified evidence of the same variant. For house-defined SKUs,
consider an inspection with photos and matching observable readings from both
products. A shared barcode or AI similarity alone would be insufficient.

The owner needs to decide which records qualify and how to handle an important
attribute that cannot be determined. The proposal leaves evidence types,
confidence rules and variant distinctions under ADR-010. These additional
evidence prerequisites are pending approval.

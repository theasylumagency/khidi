# ADR-011 — SKU split ownership and history

Status **Proposed**

## Context

During review, one SKU can turn out to represent multiple physically distinct variants. ADR-010
defines how to verify the distinction. M6 can capture this evidence and create distinct draft
SKUs. A split of an existing SKU would also change which variant its physical labels,
accounting records and future stock transactions represent.

## Proposal

Defer a SKU split operation until these decisions are approved:

- Decide who confirms the identity of each affected physical unit and which units require
  replacement labels. Define how a scan of an older ambiguous label enters review.
- Decide how accounting mappings are verified per variant and legal entity. Define how the
  operator assigns stock ownership, allocations and outstanding reservations in M8 and M9.
- Decide which evidence and photos are attributable to each variant, who confirms that
  attribution and how the original records stay traceable.
- Define which variant, if any, retains the original slug and listing. Require separate approval
  of each variant's identity and public content.

Retain original audit and transaction history. Review the proposal against the inventory and
reservation design before introducing any split that changes an active SKU.

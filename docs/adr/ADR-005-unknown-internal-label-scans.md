# ADR-005: Operator handling of unknown internal labels

- **Status:** Proposed — owner decision required before extending this flow
- **Date:** 2026-11-02
- **References:** AGENTS.md §8, §10 S2–S3; Specification §5.3–5.4

## Question

S2 creates a draft for an unknown scanned identifier. M2 reserves `INTERNAL_SKU`
and `INTERNAL_QR` for the system, and archived SKUs must never match. Creating a new
SKU from an unknown `KH-…` label would attach another SKU's system identity or
manufacture an internal identity that was not allocated by the system.

The implemented endpoint fails closed with `NOT_FOUND` for unknown or archived
internal labels. It creates no intake or SKU in that case. Existing active internal
labels resolve normally; unknown external identifiers create drafts as specified.
This guard preserves the existing identifier invariant, without defining a new
operator recovery workflow.

## Proposed next decision

The owner should decide whether a missing internal label remains a rejected scan,
or produces a `MANUAL_IDENTIFICATION_REQUIRED` intake without a matched SKU.
No alternative recovery flow is implemented pending approval. S6 remains separately
gated by the real-device gateway spike.

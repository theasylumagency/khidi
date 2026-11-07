# ADR-005: A physical scan is never lost

- **Status:** Accepted
- **Date:** 2026-11-02
- **Decided by:** project owner
- **Supersedes:** the Proposed version of this ADR (unknown internal labels fail with `NOT_FOUND`)
- **References:** AGENTS.md §8, §10; Specification §5.3–5.4, §7, §16.5

## Context

The Proposed version rejected a scan of an unknown or archived internal label (`KH-…`) with
`NOT_FOUND` and created nothing. That protects the identifier invariant, but it interacts badly
with the offline queue: a scan made offline is rejected only later, when the queue syncs. The
queue then keeps the entry as "blocked" on that one phone. An administrator never sees it, and
the physical product silently drops out of the intake.

The same problem applies to every business rejection of a queued scan, for example a task that
was completed, cancelled or reassigned while the warehouse user was offline.

## Decision

**A scan that physically happened is never lost and never lives only on a device.**

Rejections are split into two classes.

### Class A — business conditions: record for review on the server

The server accepts the scan, stores it as an intake, and marks it for administrator review.
**A Class A intake never creates or changes catalog data**: no SKU draft, no identifier
attachment. It may only *reference* an existing SKU that matches. Any catalog change happens
later, through an administrator's review resolution.

| Condition | Stored as | Counts toward task progress | Duplicate detection |
| --- | --- | --- | --- |
| Unknown internal label (`KH-…` not allocated) | `MANUAL_IDENTIFICATION_REQUIRED`, review reason `UNKNOWN_INTERNAL_LABEL` | No | Excluded |
| Internal label of an ARCHIVED SKU without a surviving merge target | `MANUAL_IDENTIFICATION_REQUIRED`, review reason `ARCHIVED_INTERNAL_LABEL`, archived SKU id kept for reference only | No | Excluded |
| Internal label of a split source (including a merge chain ending there) | `MANUAL_IDENTIFICATION_REQUIRED`, review reason `SPLIT_INTERNAL_LABEL`, source and scanned SKU retained; active split targets listed | No | Excluded |
| Identifier collision (several SKUs match) | `MANUAL_IDENTIFICATION_REQUIRED`, review reason `IDENTIFIER_COLLISION` (existing behaviour, now with a reason) | No | Excluded |
| Task completed or cancelled before the scan arrived | Existing match → `MATCHED_EXISTING` (reference only); no match → `MANUAL_IDENTIFICATION_REQUIRED`, no draft. Review reason `TASK_NOT_ACCEPTING` | No | Excluded |
| Task no longer assigned to this user or role | Same as the row above, review reason `TASK_NOT_ASSIGNED` | No | Excluded |

Rules:

- A label of a merged SKU resolves to the active survivor, following `merged_into_sku_id`
  with cycle protection. The intake keeps both `scanned_sku_id` and `matched_sku_id`.
  A broken chain or a terminal archive without a successor goes to Class A review.
  Task assignment and availability checks still apply.

- Under accepted ADR-011 Part A, a terminal split source goes to `SPLIT_INTERNAL_LABEL`
  review. Linking to an active split target queues a replacement label. Original intakes
  retain their original matched SKU. The review list shows printed-label records and
  resolved split-label reviews per source; it does not infer unit identity from a shared SKU code.

- `review_reason` is a new nullable column with the values above; `reviewed_at`,
  `reviewed_by`, `review_resolution` and `review_note` record the outcome.
- The same rule applies online and offline. An online user sees
  "ჩაიწერა, საჭიროებს ადმინის განხილვას" instead of an error.
- Class A intakes keep their `task_id` for context. They are excluded from task progress
  and from the per-task uniqueness index.
- The admin intake list gets a "Needs review" filter. Notifications follow in M10.

### Review resolutions (ADMIN only, reason or note mandatory, audited)

- **Link to an existing SKU** — sets `matched_sku_id`; if the product carries a wrong or
  archived label, a replacement label for that SKU is queued for printing.
- **Accept for task** (only for `TASK_NOT_ACCEPTING` / `TASK_NOT_ASSIGNED`) — counts the intake
  toward the task, provided the task is still open or the admin reopens it. If the intake has
  no matched SKU, this action runs the normal S2 identity processing at that moment (match, or
  create the unverified draft and attach the external identifier), in the same transaction,
  and the intake becomes `NEW_DRAFT` or `MATCHED_EXISTING`. A collision found at that moment
  keeps it in review.
- **Dismiss** — not a product, test scan, or duplicate; kept as history, never deleted.

### Class B — technical or security conditions: stay on the device

Validation errors, idempotency conflicts, user/session mismatch and device mismatch remain
"blocked" entries on the device, because accepting them would weaken authentication or data
integrity. For these:

- the queue UI shows each blocked entry with a human-readable Georgian reason;
- the owner of the entry can discard it after a confirmation;
- a discard is reported to the server when online (`OFFLINE_SCAN_DISCARDED` audit record with
  the idempotency key, scanned value, scanned time and reason), so the server keeps a trace.

## Consequences

- No physical scan can disappear without an administrator seeing it.
- The identifier invariant is unchanged: unknown or archived internal labels never create or
  attach identity.
- Schema change via a new migration (new columns and constraint updates); migrations
  0001–0004 are not edited.
- Task progress counts only clean intakes, so progress figures stay trustworthy.

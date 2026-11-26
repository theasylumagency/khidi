# ADR-017 — Closing a catalog review round early

- Status: **Accepted** (owner, 2026-11-26), with variant B for the closing questions
- Date: 2026-11-26
- Scope: legacy catalog review pilot rounds only (`/review`, `/review/results`)
- References: catalog-review-pilot.md; ADR-016; migration 0062; AGENTS.md §8, §11

## Problem

A round opens the next one only after all twenty cards are submitted, the reviewer answers the
three closing questions and an administrator records KEEP or CHANGE (`saveRound`: "Complete the
round first"). Round 1 ended with 0 of 20 submitted but substantial saved drafts. The owner has
decided (2026-11-25) that the round has served its purpose and the reviewer should not be asked to
finish the remaining verdicts, sources and answers. The system has no way to record that decision.

There is a second gap: a card of an earlier round stays writable after the next round opens,
because `savePilot` checks assignment, not whether the card's round is still current.

## Decision

### 1. Explicit early closure, ADMIN only

A new round action `CLOSE` for ADMIN, with a required note (1–1600 characters). It is allowed when
the round has fewer than twenty submitted cards and no closure or decision yet. It appends one row
to a new table `catalog_feedback_round_closures`:

| column | meaning |
| --- | --- |
| `round_no` (PK) | the closed round |
| `batch_id` | the review batch |
| `actor_id` | the administrator |
| `note` | why the round was closed early |
| `submitted_count`, `draft_count`, `untouched_count` | counts at closure, computed by the server |
| `created_at` | closure time |

The table is append-only (`enforce_append_only_table()`, no UPDATE/DELETE for `hub_app`). The
action runs in `withDomainTransaction` under the existing round advisory lock, through
`executeIdempotent`, and writes `CATALOG_FEEDBACK_ROUND_CLOSED_EARLY` to audit and outbox.

### 2. A closed round is frozen

From closure on, `savePilot` and pilot photo work reject writes to any card of that round with
CONFLICT ("Round closed"). The same freeze applies to a round that already has a KEEP/CHANGE
decision, which closes the second gap above. Entries are never rewritten: a draft stays a draft
with its last revision, and is never converted into a submission.

Before `CLOSE` or `OPEN` freezes a round, the service checks for visible photo `RENDER` attempts
on that round's products and batch without a `PREVIEW` or `FAILED` result. It rejects the action
with `CONFLICT` and the public reason `PHOTO_RENDER_PENDING` until those attempts settle. The
provider call and its result storage continue normally; the result is not discarded or hidden.
The administrator can retry after inspecting the finished photo work. Historical attempts already
excluded by the operator test-reset markers do not block the round.

### 3. Closing questions and the next round (owner chose variant B)

The completion check in `saveRound` accepts "all twenty submitted **or** a closure exists".
The three closing questions are now **optional for every round**: the reviewer may answer them
once before the decision, and ADMIN may record KEEP/CHANGE and import twenty new cards without
them. For round 1 the owner asks the questions verbally. The decision → survey foreign key is
dropped; a decision still requires a finished or closed round, checked under the round lock.

### 4. Reports

- `/review/results` shows a closure banner: date, administrator, note and the three counts.
- Drafts stay in their separate, marked section and XLSX sheet. They are never counted in the
  field table or the first sheet, so completed-card statistics keep their meaning.
- The XLSX gains no new columns; the closure note and counts are added as rows of the existing
  closing-questions sheet.
- Read-only cards, results and XLSX distinguish an unanswered question from an explicit
  `UNKNOWN` answer. They preserve saved text and source even when the answer state is still blank.

## Alternatives considered

- **Ask the reviewer to finish all cards.** Rejected by the owner: more fatigue than information.
- **Mark drafts as submitted.** Rejected: it would put unconfirmed values into completed-card
  statistics and rewrite the meaning of existing entries.
- **Keep the closing questions required.** Rejected by the owner on 2026-11-26: they are asked
  verbally for round 1 and are optional from now on (§3).

## Migration and compatibility

New migration `0067_catalog_feedback_round_closures.sql`: the table, its grants (`SELECT, INSERT`
for `hub_app`), the append-only trigger, and the decision → survey foreign key replaced by a
`round_no > 0` check. No existing migration changes, no backfill. Old rounds
without a closure behave exactly as before. Rolling back the application leaves the table unused;
a closed round would then become writable again, so roll forward instead.

## Acceptance checks

- CLOSE by a non-ADMIN → FORBIDDEN; with twenty submitted, a second time, or after a decision → CONFLICT.
- After CLOSE: draft and submit of a card in that round → CONFLICT; entries unchanged byte for byte.
- After CLOSE: the reviewer can answer the closing questions; ADMIN can then open the next round.
- After a normal KEEP/CHANGE decision: writes to the previous round → CONFLICT.
- Counts on the closure row match the entries at closure time; audit and outbox rows exist.
- Results page and XLSX show the closure; field table and first sheet count submitted cards only.
- A paused photo render blocks `CLOSE` and `OPEN` with the specific pending-render response.
  Its eventual preview remains available for acceptance; closure succeeds after it settles.
- Terminal results, attempts from other rounds/batches and excluded operator experiments do not
  block closure. A render starting while closure owns the round lock cannot slip past the freeze.
- Unanswered and explicitly unknown answers stay distinct on closed cards and in the export;
  rendering either view does not change the saved response.

## Locking

Pilot writes (`savePilot`, pilot photo work) take the round key as a shared advisory lock before
the per-card lock; `CLOSE` and `OPEN` take it exclusively. A write therefore either commits before
the closure or sees it and fails.

The pending-render check runs while that exclusive lock is held. A renderer commits its attempt
before contacting the provider, so closure sees it after acquiring the lock. A later attempt must
wait for the lock and recheck whether the round is frozen. Result persistence does not need to hold
the round lock across a provider call: while any result is outstanding, closure is refused. A
result committed just after the check can at most require the administrator to retry.

An interrupted process can leave a recorded attempt without a terminal result. Closure remains
blocked in that case: elapsed time alone does not prove a provider call failed or was not billed.
There is no automatic recovery or expiry of such attempts. Investigate the attempt and its storage
before closing the round; do not fabricate a result or use the exploratory-photo reset as recovery.
The [pilot operations note](../catalog/catalog-review-pilot.md#before-closing-a-round) includes a
read-only query for identifying these attempts.

## Visibility

The reviewer's list and cards say only that the round is closed. The closure note, date and counts
appear on the results page and in the XLSX closing-questions sheet.

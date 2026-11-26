# ADR-017 — Closing a catalog review round early

- Status: **Proposed**
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

## Decision (proposed)

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

### 3. Closing questions and the next round

The completion check in `saveRound` accepts "all twenty submitted **or** a closure exists".
Everything after it is unchanged: the reviewer answers the three closing questions, then ADMIN
records KEEP/CHANGE with a note and imports twenty new cards in one transaction. The decision →
survey foreign key stays.

### 4. Reports

- `/review/results` shows a closure banner: date, administrator, note and the three counts.
- Drafts stay in their separate, marked section and XLSX sheet. They are never counted in the
  field table or the first sheet, so completed-card statistics keep their meaning.
- The XLSX gains no new columns; the closure note and counts are added as rows of the existing
  closing-questions sheet.

## Alternatives considered

- **Ask the reviewer to finish all cards.** Rejected by the owner: more fatigue than information.
- **Mark drafts as submitted.** Rejected: it would put unconfirmed values into completed-card
  statistics and rewrite the meaning of existing entries.
- **Let ADMIN skip the closing questions (variant B).** Possible, but it needs the decision →
  survey foreign key dropped in a new migration, and reports must show "no survey". Not proposed
  by default because the three answers are the cheapest and most direct record of how the round
  went. The owner chooses between this and §3.

## Migration and compatibility

New migration `0067_catalog_feedback_round_closures.sql`: the table, its grants (`SELECT, INSERT`
for `hub_app`), the append-only trigger. No existing migration changes, no backfill. Old rounds
without a closure behave exactly as before. Rolling back the application leaves the table unused;
a closed round would then become writable again, so roll forward instead.

## Acceptance checks

- CLOSE by a non-ADMIN → FORBIDDEN; with twenty submitted, a second time, or after a decision → CONFLICT.
- After CLOSE: draft and submit of a card in that round → CONFLICT; entries unchanged byte for byte.
- After CLOSE: the reviewer can answer the closing questions; ADMIN can then open the next round.
- After a normal KEEP/CHANGE decision: writes to the previous round → CONFLICT.
- Counts on the closure row match the entries at closure time; audit and outbox rows exist.
- Results page and XLSX show the closure; field table and first sheet count submitted cards only.

## Open questions for the owner

1. Closing questions after an early close: required (§3) or optional (variant B)?
2. Should the reviewer see the closure note on her list, or only that the round is closed?

# Reset an exploratory catalog photo session without deleting evidence

This operator-only workflow is for a pilot that has not been submitted. It is deliberately a **logical reset**:
- The original WordPress catalog photos and all 248 imported products stay unchanged.
- The operator inserts immutable per-actor, per-product cutoff markers in `catalog_review_photo_test_resets`.
- The pilot gallery, photo-work history, photo-preview access and photo-work activity counters omit that actor's actions at or before the marker's cutoff. Later work by the same actor is visible.
- The already-made paid model calls are still billed externally. Khidi excludes the marked calls from **future pilot allowance** counts, so the eventual reviewer receives the unused allowance.
- Original work events, audit records, S3 media bytes and their immutable versions remain retained for accounting and investigation.
- No catalog feedback is erased. The command **refuses to act** if its target includes saved feedback.
- No triggers or append-only protections are disabled, and no business tables are truncated.

## Deployment

Apply migration `0066_catalog_review_photo_test_resets.sql` with the updated Hub code **while Hub is stopped**; an old Hub binary would not respect these markers. The command uses paired operational URLs and must be run with the service stopped for `--apply`. It does not re-import, seed, or replace media.

Use the exact production database name and event counts returned from a separate read-only inventory. Example for the verified November 20 owner photo test session:

```sh
node --env-file=.env --env-file=/etc/khidi/hub.env --import tsx \
  packages/catalog-review/src/reset-photo-tests.ts \
  --actor=george@theasylum.agency \
  --expect-database=agrotrade_hub \
  --expect-counts=7171:44,7393:2

# Check the dry-run, then add --apply to commit both markers in one transaction.
```

The command validates the active admin, selects the oldest ranked import with the pilot baseline fingerprint, checks exactly two requested WordPress IDs and their event counts, rejects any saved feedback or previous reset markers, then inserts the two reset markers and an audit row for each. A later work session is never hidden.

## Post-apply checks

Check that `/review` shows the original gallery for #7171, with no experimental history or prepared variants on either #7171 or #7393. A row for the accepted image remains in the append-only gallery links and the object remains in private storage, but neither appears as an available reviewer image. Check that the first round still has 20 cards, its 248-product source batch is unchanged, and Lika/George remain assigned. Do not mistake this for erasure of data or reimbursement of API charges.

Do not use this marker mechanism to hide actual reviewer feedback after the pilot starts.

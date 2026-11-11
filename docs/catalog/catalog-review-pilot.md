# Catalog Review pilot

The pilot adds an editorial queue to the existing Hub. It uses the same sessions, invitation and office sign-in flow, PostgreSQL, audit/outbox transaction and private media storage. A reviewer account opens at `/review`. The reviewer can see only assigned batches and can review the products that have proposals. Admins can inspect the pilot. A reviewer has no operational entity memberships or permissions.

## Migration and data flow

1. Apply migrations 0056 through 0058 on an isolated local database. They create legacy snapshot, assignment, photo, proposal, decision and first-pass report tables, and add the reviewer to the office enrollment checks. Earlier migrations stay frozen.
2. Join the Clean Baseline and Review Data v1.1 workbooks with the photo audit on WordPress product ID, and the photo inventory on asset key. Preparation validates row identity, status, original text, photo position, counts and source references. The import validates image sizes and SHA-256 values before preserving private originals and creating metadata-free WebP previews.
3. Import the 248 source rows including 31 WordPress drafts as one reviewable batch. Rank the selected 20 as a recommended starting order. Snapshot rows, photo associations, proposals and decisions are append-only. Repeating the same manifest preserves the batch and its history. Version 1 can only reopen an already-imported local walkthrough. Use the version 2 manifest for a fresh complete batch.
4. Use Hub user management to invite a local `CATALOG_REVIEWER` account. The existing user-management flow handles setup, TOTP and optional passkeys. To assign an existing reviewer, rerun the local import with that account's email as the fourth argument. Successful import, assignment and decisions write an audit row and internal outbox event. There are no storefront consumers.
5. Review each field independently. Approval records the editorial choice. Edit records a separate text version. Rejection and deferral accept an optional note. The decision's actor, timestamp and revision stay in history. Stale concurrent actions get a conflict instead of overwriting someone else's work.

The legacy records and photos have no canonical Product Master or SKU association. In this pilot, verification of specifications and identities remains with the existing evidence workflow. READY, publishing, pricing, stock and sellability retain their existing lifecycle. Any future promotion of reviewed material needs an explicitly approved mapping and existing verification gates.

The queue supports search by name or WordPress ID and filters for category and decision status. A product opens at its first pending field. Saving a new decision continues to the next pending field or to the product history. The photo panel shows only the original WordPress archive previews. When the archive has no photo, the reviewer can defer that field and leave a note.

A product counts toward the first pass when the assigned reviewer has made a decision on each available proposal. Deferral counts as a decision and remains a follow-up item. The twentieth distinct product creates one immutable report per reviewer and batch. Opening or postponing the offer acknowledges it. The report stays accessible from the queue while review continues. The email action prepares a summary draft, and the reviewer chooses the recipient and sends it through their mail app. The full report can be copied from the preview.

## Run locally

Use the repository's pinned Node/pnpm and a dedicated loopback PostgreSQL database ending in `_dev` or `_test`. Set both `DATABASE_URL` and `DATABASE_MIGRATOR_URL` to this database with their respective roles. Set `MEDIA_STORAGE_DRIVER=filesystem` or leave it unset. The importer rejects production mode, external hosts, connection overrides and non-filesystem media. Keep real workbooks, the selection, the generated bundle and copied originals outside version control.

```text
corepack pnpm db:migrate
corepack pnpm db:seed
python ops/prepare-catalog-review.py --baseline BASELINE.xlsx --review REVIEW.xlsx --media-downloader DOWNLOADER_DIRECTORY --selection SELECTION.json --output LOCAL_MANIFEST.json
corepack pnpm ops:catalog-review-pilot LOCAL_MANIFEST.json DOWNLOADER_DIRECTORY/AgroTrade_Legacy_Media ADMIN_EMAIL [REVIEWER_EMAIL]
corepack pnpm dev:hub
```

The read-only preparation step uses Python with `openpyxl`. The selection file is a JSON object keyed by WordPress ID. Each value includes `observation` and can include `checkPhotoMatch` and per-field `rationaleNotes` for NAME, SHORT and FULL. The source ZIP or workbooks and photo audit remain available for provenance. If an import is interrupted after media is written, only its database transaction rolls back. An operator can retry the import, then reconcile unreferenced private copies against the backup inventory. There is no automatic deletion.

## Acceptance before a shared pilot

- On an isolated database, check the migration, all 248 reviewable records, the 20 recommended ranks, assignment isolation, safe photo reads and repeat import.
- Check the 19th, 20th and 21st passes, including deferrals and repeated decisions, and check that a second reviewer cannot open the first reviewer's report.
- Verify approve, reject, edit and defer with notes and history. Check a replay, simultaneous updates, a photo from a different product and unchanged canonical state.
- Walk through two examples with the reviewer. Use a candidate with a specification conflict and one with a missing or uncertain photo. Confirm wording, comparison and photo selection on a phone and a desktop.
- Confirm recovery of private originals and previews in a separate restore. The existing restore snapshot includes the review media references. Approve the shared storage permissions, gateway access and release plan before any shared deployment or import.

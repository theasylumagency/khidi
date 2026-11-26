# Catalog Review pilot

## November 19 feedback round

Proposed next card version (store preview, complete facts, `fits` links): see
[catalog-review-card-v3.md](catalog-review-card-v3.md).

Apply migrations 0061 and 0062 with the updated Hub. The first twenty versioned proposals live in PostgreSQL. The oldest ranked import with the configured archive fingerprint supplies their product IDs and original photos. Existing feedback revisions remain immutable. An already-started unidentified card keeps its place during migration.

At `/review`, the assigned reviewer edits six fields (name, description, ordered facts, kit, typed links and photos). Each field has an independent verdict. A change or inapplicable field may carry a reason; since 2026-11-25 (owner decision) the reason is optional and only the verdict is required. Missing evidence can be marked independently. Product-specific questions retain their sources; a known answer still requires one. Saving a draft preserves the initial proposal, gallery and order. Submitting freezes that card.

At `/review/results`, choose a round or product type, inspect word and list changes and download the two-sheet XLSX. Only submitted cards count in the report. Saved drafts are listed separately below the summary and on their own XLSX sheet; they never enter the counts or the first sheet. Once twenty are complete, or an administrator closes the round early with a note (ADR-017), the reviewer may submit the three closing answers; since 2026-11-26 they are optional. A closed or decided round is frozen: drafts stay drafts and no card can change. The next cohort remains inaccessible until an administrator records KEEP or CHANGE with a note and imports twenty prepared cards. Both operations commit together. Viewing or exporting results never opens a round.

The release form lists the remaining eligible WordPress IDs and downloads a JSON template. Replace or edit its twenty entries, supply a product type and customer-facing description, and review the facts, kit, typed links and questions. Links refer to other WordPress IDs in that cohort. A round takes its gallery from the existing import. Historical results remain available under their round number. These editorial decisions do not publish changes to canonical product data.

The pilot adds an editorial queue to the existing Hub. It uses the same sessions, invitation and office sign-in flow, PostgreSQL, audit/outbox transaction and private media storage. A reviewer account opens at `/review`. The reviewer can see only assigned batches and can review the products that have proposals. Admins can inspect the pilot. A reviewer has no operational entity memberships or permissions.

### Before closing a round

Closing a round or opening its successor waits for photo rendering to settle. An attempt is pending
when it has a visible `RENDER` entry and no `PREVIEW` or `FAILED` result. The close/release form explains
that photo processing has not finished; review the result and retry. Existing previews and accepted
photos remain stored, and draft answers are never changed by closing the round. Read-only cards,
results and the XLSX label unanswered questions separately from explicit uncertainty while retaining
any saved answer text and source.

Before a release or round closure, inspect pending attempts using the confirmed pilot batch ID and
round number as the psql variables `batch_id` and `round_no`. This query is read-only; the server
repeats the check under its round lock when the administrator submits the action.

```sql
SELECT w.id AS attempt_id, p.wordpress_id, w.actor_id, w.model, w.created_at
FROM catalog_review_photo_work w
JOIN catalog_legacy_products p ON p.id = w.product_id
JOIN catalog_feedback_round_cards c ON c.wordpress_id = p.wordpress_id
WHERE w.batch_id = :'batch_id'::uuid
  AND c.round_no = :round_no
  AND w.kind = 'RENDER'
  AND NOT EXISTS (
    SELECT 1 FROM catalog_review_photo_test_resets r
    WHERE r.product_id = w.product_id AND r.actor_id = w.actor_id
      AND w.created_at <= r.cutoff_at
  )
  AND NOT EXISTS (
    SELECT 1 FROM catalog_review_photo_work result
    WHERE result.parent_id = w.id AND result.kind IN ('PREVIEW', 'FAILED')
  )
ORDER BY w.created_at, w.id;
```

A process interrupted after recording its attempt may leave a pending row even though no provider
call is still running. Such a row continues to block closure and needs investigation against logs,
provider status and stored media. Retrying the same render key does not call the provider again.
There is no general settlement command in this release: do not invent a failure, delete history,
or use the exploratory-photo reset to bypass this check. An audited recovery operation would need
its own implementation before such an orphaned attempt can be resolved safely.

## Migration and data flow

1. Apply migrations through 0060 on an isolated local database. Migrations 0056 through 0058 create legacy snapshot, assignment, photo, proposal, decision and first-pass report tables, and add the reviewer to the office enrollment checks. Earlier migrations stay frozen.
2. Join the Clean Baseline and Review Data v1.1 workbooks with the photo audit on WordPress product ID, and the photo inventory on asset key. Preparation validates row identity, status, original text, photo position, counts and source references. The import validates image sizes and SHA-256 values before preserving private originals and creating metadata-free WebP previews.
3. Import the 248 source rows including 31 WordPress drafts as one reviewable batch. Rank the selected 20 as a recommended starting order. Snapshot rows, photo associations, proposals and decisions are append-only. Repeating the same manifest preserves the batch and its history. Version 1 can only reopen an already-imported local walkthrough. Use the version 2 manifest for a fresh complete batch.
4. Use Hub user management to invite a local `CATALOG_REVIEWER` account. The existing user-management flow handles setup, TOTP and optional passkeys. To assign an existing reviewer, rerun the local import with that account's email as the fourth argument. Successful import, assignment and decisions write an audit row and internal outbox event. There are no storefront consumers.
5. Review each field independently. Approval records the editorial choice. Edit records a separate text version. Rejection and deferral accept an optional note. The decision's actor, timestamp and revision stay in history. Stale concurrent actions get a conflict instead of overwriting someone else's work.

The legacy records and photos have no canonical Product Master or SKU association. In this pilot, verification of specifications and identities remains with the existing evidence workflow. READY, publishing, pricing, stock and sellability retain their existing lifecycle. Any future promotion of reviewed material needs an explicitly approved mapping and existing verification gates.

The queue supports search by name or WordPress ID and filters for category, decision status and photo activity. A product opens at its first pending field. Approval, rejection or deferral continues to the next pending field or to the product history; saving an edit stays on that field for explicit approval. The photo panel shows archive previews, reviewer uploads and accepted compositions. A reviewer can upload a missing photo or defer the field with a note.

The next-product link preserves all active filters, including search. The text panel can
highlight additions and removals without changing either source; this is a textual comparison,
not factual verification. Photo inspection opens a separate viewer and does not select a main
photo. The viewer uses the same protected preview (up to 960 px), with original archive dimensions
and automatic quality hints displayed separately. Blank source fields and absent proposals are
identified explicitly. See the [workspace plan and verification record](catalog-review-workspace.md)
for the interface work and proposed follow-up decisions.

### Text entry and exact approval (ADR-016 Part A)

After migration 0059, a reviewer can add NAME, SHORT or FULL when no proposal exists. Saving
creates a manually attributed proposal and the first EDIT in one audited transaction. It never
changes the source baseline or requires a new import. A simultaneous first save gets CONFLICT;
an identical retry replays the original result.

Saving an edit stays on the field for inspection. The version picker lists the original imported
proposal and saved edits with author/revision/date. **ამ ტექსტის დამტკიცება** approves precisely
the displayed version. The request carries its identity, and the server copies its immutable
text into the approval; history and new reports include that snapshot. A stale global revision
fails without overwriting a newer decision. An error leaves the open form intact; persistent
draft recovery is a separate future change.

Old approvals have no recorded text version and are marked accordingly; the UI does not infer
their intended version from nearby edits. Old reports remain frozen. First-pass counting still
includes EDIT and DEFER. Adding a field creates an additional review item; no new publishing or
completion gate is introduced. Saved/approved names appear in the private review heading/search
under the existing personal/global decision scope, while the comparison retains the old name.

Deploy 0059 with the new app while Hub is stopped, using the existing operations environment
and normal recovery point. Do not re-import or seed. The previous binary cannot write new text
approvals after this migration because it omits the explicit source/snapshot: use a forward fix
if needed; do not remove the migration or rewrite history. Existing photo decisions are compatible.

A product counts toward the first pass when the assigned reviewer has made a decision on each available proposal. Deferral counts as a decision and remains a follow-up item. The twentieth distinct product creates one immutable report per reviewer and batch. Opening or postponing the offer acknowledges it. The report stays accessible from the queue while review continues. The email action opens a summary draft addressed to `hello@theasylum.agency`. The reviewer sends it through their mail app and can copy the full report from the preview.

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

## Shared pilot

Apply migration 0060 for the review photo editor. In the product's photo tab a reviewer can
upload an additional gallery image, or select a gallery base, describe an accessory, choose
an inset or a mounted illustration and upload the accessory reference. The initial placement
and size are suggestions. The reviewer can adjust them and compare saved previews before
accepting one into the private review gallery. Originals and intermediate versions remain
available. An accepted composition is editorial media and does not verify fit or box contents.
The queue shows affected products, history identifies the actor and first-pass reports created
after migration include the reviewer's uploads, requests and accepted edits by product.

Migration 0064 extends the editor into a photo workbench, opened from the photo block of the
store-preview card. Besides uploads and accessory details it offers:

- **Adjust** (Sharp, no provider): quarter turns, trimming of plain borders, automatic tone and
  the square white canvas. The result is a real photo and may become the main image.
- **Clean up** (AI): the reviewer names what to remove and marks a square; only that square is
  taken from the model, every other pixel stays the original.
- **White background** and **in-use scene** (AI): the whole image is generated.
- **AI instruction** (migration 0065): the reviewer writes what to change in plain Georgian
  ("remove the rust from the engine"); examples are one click away. The model is told to change
  nothing else and to add no parts. She may limit it to a square; then only that square is taken
  from the model.

Results are stored by kind, and the kind decides what the reviewer must confirm before the
photo can lead the card (owner decision, 2026-11-20):

- **Photo** (upload, adjustment): no confirmation.
- **AI edit** (clean-up, white background, AI instruction; origin `AI_EDIT`): may be the main
  photo once she confirms she compared it with the original and the product looks as the buyer
  will receive it. Buyers see it as
  an ordinary photo; the review view marks it.
- **Illustration** (mounted or inset detail, scene; origin `COMPOSITION`): the card advises against
  using it as the main photo and offers to restore a real one. She may still choose it, with an
  acknowledgement and a reason. It keeps an illustration badge in the store view, buyer view included.

The server enforces these confirmations when a card is finished. The export's "main photo" column
records the kind and her reason. The reviewer can accept a preview into the gallery or reject it
with a reason; rejections are kept as pilot evidence per method.

Providers are optional and server-only. `REVIEW_OPENAI_API_KEY` enables GPT-Image-2.6 Sunburst
(quality `high`) and Flare (`medium`) through `POST /v1/images/edits`. The square is sent as a
transparent red-outline `markup` image. `REVIEW_GEMINI_API_KEY` enables Gemini 3 Pro Image and
Gemini 3.1 Flash Image. GPT-Image-2.6 Sunburst is preselected as the only method (owner
comparison, 2026-11-20: on a white background, a scene and a sharpening instruction both OpenAI
models kept the product, while both Gemini models redrew parts in scenes, at about twice the cost).
The reviewer may add a second method to compare. When the chosen photo's shorter edge is under
800 px, AI actions warn that the model would have to invent fine detail and suggest a new photo. Each
paid call is recorded before the provider is contacted and counts against two limits: 16 per
product and `REVIEW_AI_RENDER_LIMIT` across the pilot (default 160). Failed or interrupted calls
count too, and retries with the same key never call the provider again. Images sent to a
provider are re-encoded without metadata. The editor works without any provider key.

Before the approved Hub release, use the [upgrade and recovery runbook](../ops/server-setup.md). Keep the version 2 manifest and the audited `originals/` tree in a restricted operator directory outside the release, Git and the web root. Run the file-only preview before the handover and again after transfer. It prints the manifest SHA-256 and validates every referenced original against its audit.

```sh
corepack pnpm ops:catalog-review-pilot --preview LOCAL_MANIFEST.json AUDITED_MEDIA_DIRECTORY
```

The AgroTrade batch preview should show 248 products, 31 WordPress drafts, 20 recommended starts, 733 proposals and 456 unique originals. Compare the manifest digest to the verified source. Import only that batch on the approved destination after the release and its recovery point have been verified. Run pending migrations through 0060 using the normal release procedure. An existing imported batch can use the photo editor without re-import.

1. Use the approved operations configuration with `NODE_ENV=production`, the paired database credentials and the existing private media storage. Run the import from the release directory with an active administrator for audit attribution. The batch stays unassigned until a reviewer is named.

   ```sh
   corepack pnpm ops:catalog-review-pilot --apply-shared --expect-database=APPROVED_DATABASE LOCAL_MANIFEST.json AUDITED_MEDIA_DIRECTORY ADMIN_EMAIL
   ```

2. Record the resulting batch ID and counts. Add the reviewer's confirmed office email to the app gateway and create their `CATALOG_REVIEWER` account under **მომხმარებლები**. Copy their one-time setup link from the admin screen and keep it out of the release record.
3. Rerun the same import command with `REVIEWER_EMAIL` appended. The existing batch is assigned without replacing records or decisions. Confirm the protected `/review` route and review-photo access. Hand the one-time setup link privately to the reviewer. After password and authenticator setup, they can use `https://app.khidi.app/review` to return.

If a transfer is interrupted, repeat the file-only preview after resuming it. If an import fails, inspect its error, rerun the same verified bundle when ready, and reconcile any unreferenced private copies using the existing backup inventory. See the [release runbook](../ops/server-setup.md) for rollback. For reviewer access changes use the gateway and [user management](../ops/user-management.md).

### Acceptance

- On an isolated database, check the migration, all 248 reviewable records, the 20 recommended ranks, assignment isolation, safe photo reads and repeat import.
- Check the 19th, 20th and 21st passes, including deferrals and repeated decisions, and check that a second reviewer cannot open the first reviewer's report.
- Verify approve, reject, edit and defer with notes and history. Check a replay, simultaneous updates, a photo from a different product and unchanged canonical state.
- Walk through two examples with the reviewer. Use a candidate with a specification conflict and one with a missing or uncertain photo. Confirm wording, comparison and photo selection on a phone and a desktop.
- Confirm recovery of private originals and previews in a separate restore. The existing restore snapshot includes the review media references. Approve the shared storage permissions, gateway access and release plan before any shared deployment or import.

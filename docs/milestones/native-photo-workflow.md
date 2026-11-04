# Native photo workflow revision — Android feedback

Date: 2026-11-04. Branch: `codex/native-photo-workflow`.
Stacked on `fix/mobile-camera-ux` at `194c25969809788a72026cbd26ae1f850f5c2cc7`
(PR #6, still open when this revision started). Review this revision against that branch;
after #6 merges, retarget to `main`. Do not merge or deploy automatically.

## Result and design decisions

The full-screen barcode scanner retains its stream, frame, torch, decoder, manual entry
and no-barcode actions. Two readable lines above the frame explain placement and automatic
scanning. A new photo-required scan goes directly into the photo workspace, with a short
barcode-recorded notice. Duplicate and no-barcode behavior remains governed by existing rules;
no barcode-success notice is invented for a no-barcode intake.

One compact photo workspace shows the current configured slot, its instruction, a small
framing illustration, and one prominent “კამერის გახსნა” action. It uses the native rear-camera
JPEG input. Gallery is a secondary action. Photo stream mode, the extra shutter, horizontal
slot tabs and the second application acceptance screen are removed. The barcode stream remains.
A light photo workspace visually identifies the change of activity; its content stays bounded
on desktop and scrolls on short screens. Controls retain touch targets of at least 48 px.

A native/gallery result runs existing device Tier-1 checks and automatically commits the exact
original file to the existing IndexedDB queue. The next required configured slot appears only
after that commit. Cancelling changes nothing. Storage failure retains the checked candidate
and captured time for retry, without increasing the count or moving the step. A failed quota
or list refresh after a successful commit does not falsely report that the capture was lost.
No network receipt is needed to continue taking photos.

Saved-slot rows show thumbnails and allow retaking; each retake is an additional immutable
candidate for the same intake. The counter counts distinct configured slots, including optional
slots, and only required slots gate finishing. Optional slots are labelled and can be skipped.
The existing explicit cannot-photograph reason is queued/audited through the existing mechanism,
with a short local-save acknowledgment after returning to the scanner.

Device-save feedback, queued/blocked state and validated server receipt are displayed separately.
An uploaded older image does not make a queued retake appear synced. The queue adapter exposes
its committed key and bounded in-memory UI receipts; the IndexedDB schema, transport validation,
retry/backoff, idempotency, ownership, intake dependencies and candidate linking are unchanged.

The choice follows [Apple's feedback guidance](https://developer.apple.com/design/human-interface-guidelines/feedback)
for feedback integrated into the workflow and [W3C status-message guidance](https://www.w3.org/WAI/WCAG21/Understanding/status-messages)
for nonblocking announcements without moving keyboard focus. Native camera selection uses the
[standard capture input](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/capture).

## Changed files

- `apps/hub/src/components/guided-photo-capture.tsx`: compact native/gallery workspace and saved-slot rows.
- `apps/hub/src/lib/photo-workflow.ts`: presentation flow for checking, durable acceptance, retry and progression.
- `apps/hub/src/lib/photo-workflow.test.ts`: asynchronous acceptance, cancellation, failure, retakes and stale offline context.
- `apps/hub/src/components/photo-workspace.tsx`: existing queue/context connected to thumbnails and receipt presentation.
- `apps/hub/src/components/scan-queue-provider.tsx`: committed capture keys and UI-only validated receipt tracking.
- `apps/hub/src/components/warehouse-scanner.tsx`: instruction lines and scan/attention handoff feedback.
- `apps/hub/src/lib/camera-flow.ts`: presentation-only scan-notice flag.
- `apps/hub/src/components/camera-shell.css`: compact photo layout and scanner instruction contrast.
- `apps/hub/src/components/camera-surface.test.tsx`: native-only rendering, dynamic slots and truthful receipt states.
- `packages/i18n/src/index.ts`: Georgian UI copy.
- `vitest.camera.config.ts`: database-independent workflow test inclusion.
- `docs/adr/ADR-007-photo-capture-and-tier1.md`: owner's native/auto-accept UX decision; device/server quality rule preserved.
- `docs/milestones/mobile-camera-ux.md`: prior stream/accept description explicitly superseded by this revision.
- `docs/milestones/native-photo-workflow.md`: this record, verification and Android checklist.

No migrations, new dependencies, authentication changes, seed changes or production-data changes.

## Verification

- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`, including `check:boundaries`: passed.
- `corepack pnpm test` twice: **41 files / 216 tests** passed on fresh
  `khidi_photo_revision_final_test` (PostgreSQL 18.4), then on its re-run, including
  real disposable MinIO integration. No shared database was used.
- `corepack pnpm build`: passed.
- Local browser checks at 390 × 844 use synthetic photo fixtures and separate
  `khidi_photo_revision_ui_test`: direct scan/photo handoff, resolution failure staying
  at 0/3, native and gallery auto-save/advance while offline, retake keeping the unique
  count, reopening and delivering pending originals, duplicate suppression and original
  missing-slot completion, pending → server-received status after reconnect, and visible
  cannot-photograph reason acknowledgment. At the final 2/3-slot mobile state the workspace
  measures 390 × 844 with no sideways overflow; all remaining actions fit and touch targets
  measure 48–62 px. Test database inspection confirmed the first intake's MAIN has two candidates,
  with one SECONDARY and one IDENTIFICATION candidate, all on the original intake.

The six new workflow tests exercise asynchronous check/commit ordering, cancellation,
storage retry retaining the same checked capture/time, quality failure, immutable candidate
retakes, configured ordering/optional slots and stale offline context. Rendered-surface tests
also distinguish a blocked local photo, a matched receipt and a queued retake of an uploaded slot.
The separate camera configuration runs these without PostgreSQL.

## Limits and Android installed-PWA checklist

Browser fixture tests do not certify real camera hardware, focus, native chooser cancellation,
Android Back/lock behavior or installed-PWA compatibility. Failed-save candidates remain in the
mounted workspace's memory until saved; a page exit cannot make an unsuccessful storage write
durable. Uploaded slot status remains available after reopening; its old private thumbnail is
represented by a check icon when no local blob is available. No new media-read endpoint is added.

On `camera.khidi.app`, after an owner-approved test deployment, record device/OS/browser/PWA
version and check:

1. Scanner instructions remain readable over the feed; frame, torch, supported codes, repeated-frame
   suppression, manual/no-barcode entry and Back work as before.
2. New scan → immediate photo workspace → native rear camera. OS acceptance automatically checks,
   saves and advances once. OS cancellation leaves the step/count unchanged. Read the model plate
   and confirm native full resolution.
3. Gallery uses the same flow. Retake a saved slot: previous original remains, the count does not
   increase, and the next missing required slot is offered. Check optional/covered and configured slots.
4. Test poor quality, denied permissions, low storage and save retry. No false success or step advance.
   A cannot-photograph reason gives visible confirmation and flags the intake for admin attention.
5. Disconnect in an already-open task: new capture stays immediate, known duplicates do not open
   photos, queued scans/photos survive reopening, and uploads occur after their own intake. Reconnect:
   pending status becomes server-confirmed after receipt; all originals remain available to admin.
6. At portrait width, controls/text do not overlap or overflow sideways. Scroll if necessary, rotate,
   close/reopen and background/lock; the task and safely queued work are preserved.

TOTP, passkeys and M5 remain separate work. Production `app.khidi.app` and the shared database
were not used for this revision's tests.

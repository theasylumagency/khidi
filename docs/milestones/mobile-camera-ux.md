# Mobile camera UX — pre-M5 task 1

Branch: `fix/mobile-camera-ux`, based on `main` at
`436f111b59f9786a190a9fac9c65503575547747`, after M4 PR #3 was merged.
No migrations, dependencies, authentication, seed data or business rules changed.
ADR-005 and ADR-007, including advisory server Tier-1, remain in force.

## Implemented

- One reusable native modal camera shell for scanning and guided photos, above the Hub UI.
  It fills `100dvh`, respects safe areas, prevents background scrolling and restores focus
  and scroll position when closed. It does not use the Fullscreen API or force orientation.
- One owned history entry per opening. Browser/Android Back closes the overlay and leaves
  the current task page; close/Escape removes the owned entry without altering another
  navigation's entry. Closing preserves scan input and unfinished in-memory photo work.
- Optional Screen Wake Lock; release on close/background/page exit, reacquire on foreground
  while the shell remains open. Late/denied requests are harmless. Shell stops registered
  scanner/photo controllers; existing controller track cleanup remains unchanged.
- Scanner video covers the entire surface. Its guide stays inside the visible video area;
  decoding still sees full frames. Compact progress, conditional torch, transient acceptance
  status and manual/no-barcode bottom sheets replace the embedded camera and surrounding cards.
- Distinct optional vibration patterns for accepted, duplicate and review results. Local
  acceptance still waits only for IndexedDB persistence. No extra confirmation for a normal
  barcode scan; required-photo work transitions directly into photo mode and back.
- Native rear-camera JPEG capture remains primary. A framing illustration/instruction is
  shown before the chooser. Returned native/picker/stream photos get an uncropped preview
  with device Tier-1 results and accept/retake actions. Only acceptance writes the existing
  durable photo queue and shows “✓ ფოტო მიღებულია”.
- Optional stream preview uses `object-fit: contain`; the guide uses the visible image's
  contained bounds, recalculated for container/video size changes. Capture still uses actual
  full-resolution video pixels and the configured minimum; original files are not modified.
- Required/optional/covered slots, cannot-photograph reasons, duplicate/original-intake rules,
  per-user ownership, delivery dependencies and upload/processing paths are preserved.

Presentation lifecycle and flow transitions are independent of domain services and tested
without a browser or database. React components use them directly; the shell owns no intake
or queue decisions. A still-unaccepted preview remains in component memory when the shell
closes, until the workspace is left. Accepted photos retain the existing IndexedDB guarantees.

## Verification

Typecheck, boundaries/lint and the production build pass. The full suite passes twice:
**40 files / 207 tests** on fresh `khidi_camera_acceptance_test` (PostgreSQL 18.4) and on
its re-run, including real temporary MinIO integration. New camera tests also pass separately
without PostgreSQL:

```sh
corepack pnpm exec vitest run --config vitest.camera.config.ts
```

Nine new tests cover owned history/Back, wake-lock lifecycle and late/denied requests,
track-stop callbacks, state preservation, manual return, scanner → photo → scanner flow,
portrait/landscape contained geometry, optional vibration and rendered scanner/photo contracts.
The existing decoder, repeated-frame, torch, controller cleanup, quality and offline tests
are retained. TSX presentation tests now participate in the full suite.

Local browser checks use synthetic fixtures and a separate `khidi_camera_ui_test` database:
390 × 844 full-screen bounds, hidden surrounding navigation, cover/contain styles, Back and
Escape preserving the task page/focus, retained manual input and unaccepted preview,
all three required slots, return to scanner, local duplicate suppression, and an offline
scan/photo pair that delivers after reconnect. Browser inspection found/fixed min-content
overflow on narrow photo screens. No real webcam stream or phone hardware was certified.

## Real-device checklist — owner verification still required

Record device model, OS/browser, installed-PWA state, date and evidence for each result.

### Android installed PWA, behind the gateway

- Open the task scanner: no Hub header/navigation/cards remain above the full-screen camera;
  portrait feed fills the screen without a narrow strip. Rotate naturally; guide stays inside
  visible video. Supported code formats and repeated-frame suppression behave as before.
- Torch appears only on capable tracks; test on/off. Accepted/duplicate/review scans give
  distinct vibration where supported, and readable visual feedback in all cases.
- Use Android Back, the close button and Escape (keyboard): return to the same task with
  progress/input preserved; focus returns to the launch action. Reopen and continue.
- Open/close manual and no-barcode sheets; successful input returns to scanner immediately,
  or to required photos. Verify no new confirmation for ordinary decoded scans.
- Screen stays awake while open where supported. Denied wake-lock/camera permission has a
  usable fallback. Background, lock and navigate away: streams/torch stop; return and retry.
- New required-photo scan → guide → native camera → preview → accept/retake → remaining slots
  → scanner. Confirm native full resolution/HDR/focus on a product and a readable model plate.
- Test optional live stream in portrait/landscape: preview and guide match the exact saved
  area, with no cover crop. Low-resolution streams offer native capture instead of upscaling.
- Required slots cannot be skipped. Test covered optional slots, missing-slot completion,
  picker fallback, cannot-photograph reason and duplicate/KH-label attachment behavior.
- Disconnect while the already-open app is running: new scan starts capture immediately;
  photos wait for their intake, survive reconnect and upload with the original user's session.

### iPhone installed PWA and desktop/tablet

- Repeat the applicable Android list, including safe areas, natural portrait video, native
  rear camera, picker, stream contain preview, denied permissions and background/return.
- iPhone vibration/torch support is not assumed; visual feedback alone must be sufficient.
  Validate regular overlay behavior without `requestFullscreen`.
- Desktop/tablet Quick Scan and admin media work remain usable. Escape closes the overlay,
  keyboard focus is visible, input and accepted/queued work are preserved.

## Handoff

Open a PR to `main` and stop without merging. Task 2 (`feat/totp-enrollment-recovery`)
starts only after this PR is merged; passkeys start only after Task 2 is merged.

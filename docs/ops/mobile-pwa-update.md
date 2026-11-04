# Mobile PWA hydration incident and safe camera-test update

Date: 2026-11-04. Branch: `codex/native-photo-workflow`, PR #7.

## Confirmed cause

The `khidi-static-v2` service worker used cache-first for all `/_next/static/*` responses.
Next 16.4.3 Turbopack development bundle URLs are mutable: their content can change without
changing their URL. CacheStorage does not honor HTTP freshness headers automatically
([MDN Cache](https://developer.mozilla.org/en-US/docs/Web/API/Cache)). The old worker therefore
returned an old shared i18n module despite `Cache-Control: no-cache, must-revalidate`, while
HTML and a newly named scanner chunk came from the updated server. The old dictionary had
no `camera.scanner_place`, so the client rendered an empty `<strong>` against the server's
Georgian instruction. The translation and its default Georgian locale were correct.

This was reproduced using the actual Next/React browser hydration, not static rendering:

1. Start a disposable historical checkout at `194c259` with Next 16.4.3 Turbopack and a dedicated
   `khidi_hydration_ui_test` database. Sign in with development fixtures and visit the task page
   twice so the existing v2 worker caches its runtime assets.
2. Close the browser tab, retain its service worker/cache, and update the still-running source
   to `b39e863`. Reopen `/warehouse/tasks/[taskId]`. React reports the exact supplied mismatch
   at `warehouse-scanner.tsx:145`, removing the server's `მოათავსეთ ბარკოდი ჩარჩოში` text.
3. The origin's current dictionary bundle at the same URL contains the new key, but the cached
   client response does not. Observed SHA-256 fingerprints of that same fixture chunk:
   cached `e5e1dc7ae8c1b4b03038f37b675baf7cc0a240969774175d20cb4087b3d3af25`;
   current origin `bc2f9dfd9d729890aae624c8940bd7be3f76848c4e12f2afe43dc487f3f8bf3c`.
   The fixture's i18n source is identical to the repository's `b39e863` source.
4. Stop the disposable dev server, move aside only its `.next` artifacts, restart and reopen.
   The same hydration error persists. With only service-worker caching bypassed for a control
   load, the current dictionary is returned and real hydration has zero errors.
5. Activate the corrected worker normally, without deleting browser site data: v2's 39 cached
   entries (32 runtime entries) become v3's 7 bootstrap assets with zero runtime entries.

PR #6/#7 initial render state was also checked: the translation function is deterministic;
scanner/camera/queue state initializes consistently; browser APIs, random IDs, capture times
and blob URLs are used in effects or actions rather than the initial server/client render.
A fresh matching-code load and normal task-list navigation did not reproduce another mismatch.

## Corrective change

The worker caches only manifest/icons. Next JS/CSS follows Next's normal HTTP cache policy,
including immutable production asset caching by the browser. `khidi-static-v3` activation
purges the previous worker cache generation. Registration uses `updateViaCache: "none"`,
consistent with the [Next PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps).
No forced page reload, warning suppression, SSR disabling, dictionary change or camera rewrite
is involved. IndexedDB, cookies, sessions and queued scans/photos are not cleared by this fix.

The worker update must finish before a new scanner document is loaded. A document already
loaded with old modules can still report its existing mismatch until it is reopened; changing
server files cannot replace JavaScript that has already executed in that document.

## Safely updating camera.khidi.app

These are operator instructions, not an automatic deployment. Use **only** the isolated
`/var/www/khidi-camera` checkout and `khidi-camera-test.service`; production `app.khidi.app`
and its service/database are outside this procedure. Tests and seeds never run on this server.

1. Finish any active native-camera operation and allow the current file to be saved locally.
   Queued work may remain. Do not uninstall the PWA or clear site data/IndexedDB.
2. Stop the isolated service before updating source. Inspect the checkout and fetch the branch:

   ```sh
   cd /var/www/khidi-camera
   sudo systemctl stop khidi-camera-test.service
   git status --short
   git branch --show-current
   git fetch origin codex/native-photo-workflow
   git diff --name-only HEAD..origin/codex/native-photo-workflow
   ```

   Verify the expected branch/head against the PR and ensure the incoming files do not include
   `apps/hub/next.config.ts`, `apps/hub/next-env.d.ts` or `.camera-db.env`. Preserve the local
   `allowedDevOrigins`, generated dev paths and test database configuration. If unrelated local
   source changes exist, inspect them before proceeding. Never use `git reset --hard`, `git clean`,
   a blanket stash, or replace those environment-specific files.
3. With that checkout on `codex/native-photo-workflow`, fast-forward it, then start the service:

   ```sh
   git merge --ff-only origin/codex/native-photo-workflow
   sudo systemctl start khidi-camera-test.service
   sudo systemctl is-active khidi-camera-test.service
   ```

   No dependency change, migration, seed or database reset is required. Clearing `.next` alone
   does not resolve this incident; it leaves the phone's worker cache intact. Keep existing
   environment configuration and confirm the isolated health endpoint is healthy as usual.
4. In each affected browser/installed PWA, open the existing authenticated
   `https://camera.khidi.app/diagnostics/pwa-spike` page while online to trigger the worker update.
   Allow it to complete, fully close the PWA and its browser tabs, then reopen the task.
   Do not clear browser data. Where remote/desktop developer tools are available, explicitly
   request the update **on camera.khidi.app only**:

   ```js
   const registration = await navigator.serviceWorker.getRegistration('/');
   await registration?.update();
   ```

   Wait until the new worker is activated/controlling the page. The expected CacheStorage name
   is `khidi-static-v3`; it contains manifest/icons and no `/_next/` entries. Then reopen the
   task. Do not run `indexedDB.deleteDatabase`, clear all site storage, unregister/delete the
   installed PWA, or discard queued scans/photos as a recovery measure.
5. Verify fresh task loading, task-list navigation, scanner instructions, native photo auto-save,
   offline queue and reconnect. Close/reopen the installed PWA after restarting the isolated
   dev service once more. Confirm that hydration errors do not return and local work survives.

If a phone still receives an old module after v3 is active, collect the module request URL,
`fromServiceWorker`/cache source, response headers and current worker/cache version. Inspect
any gateway/proxy caching of development assets before changing translations or SSR behavior.
Do not include credentials, session cookies or the contents of `.camera-db.env` in reports.

## Verification

- Eight worker-policy tests execute the actual worker source against persistent cache mocks:
  mutable runtime JS/CSS/HMR/build manifests, legacy cache invalidation, offline bootstrap,
  document/RSC/API/write/origin exclusions and the existing explicit logout purge.
  Six failed against the old worker; all eight pass with the correction.
- Camera/PWA checks without PostgreSQL: 4 files / 26 tests pass.
- Typecheck and lint (including dependency boundaries): pass.
- Production build (`corepack pnpm build`): pass.
- Full suite twice: 42 files / 224 tests pass on fresh `khidi_hydration_final_test` (PostgreSQL 18.4)
  and its re-run, including disposable MinIO integration.
- Real browser checks use the isolated historical checkout, synthetic photos and a separate
  test database. No production or shared data/configuration was changed.
- After the fix: fresh hydration and task-list navigation have no hydration errors. Restarting
  the Turbopack server and reopening the browser with persistent worker storage also has zero
  errors; a measured reload requested 18 Next runtime assets and none came from the worker.
  One offline scan/photo pair survived closing/reopening and was delivered after restart.
  Native file capture still checks, durably saves and advances without another confirmation.

Real Android/iPhone installed-PWA reopening must be confirmed on those devices after the
operator applies this update. The local browser reproduces the actual worker-cache and React
hydration failure; it does not certify phone hardware or OS lifecycle behavior.

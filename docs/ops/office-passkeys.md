# Khidi office passkeys

Office users may add platform passkeys from **ანგარიშის უსაფრთხოება** after password plus
TOTP sign-in. Registration is always an explicit action; canceling the operating system prompt
leaves the account unchanged. A passkey may sync through iCloud Keychain, Google Password
Manager or another platform provider. It identifies the user, not a trusted physical device.
Khidi never receives fingerprint, face or device-PIN data. See [ADR-008](../adr/ADR-008-office-passkeys.md).

## User paths

- The signed-out welcome page offers **შესვლა** for password/TOTP. A personal browser that
  has registered or used an active passkey puts **სწრაფი შესვლა** first. A registered warehouse
  browser puts **პირადი PIN-ით შესვლა** first.
- After strong password/TOTP sign-in, an eligible personal browser offers **ჩართეთ სწრაფი
  შესვლა** once for the remembered account when it has no active passkeys. **მოგვიანებით**
  continues to the Hub. Setup remains available in **ანგარიშის უსაფრთხოება**. Verification
  uses Face ID, fingerprint or device unlock code as offered by the operating system.
- A new credential receives its name automatically from the coarse registration platform.
  The security page shows the platform, creation date and last use. Older credentials retain
  their labels, with registration platform shown as unknown. The platform is descriptive
  metadata, never proof of hardware identity.
- **სწრაფი შესვლა** uses discoverable credentials; no email lookup is exposed publicly.
  Cancel or failure leaves password/TOTP fallback available. Account existence, revocation
  and internal verifier errors share one anonymous failure message.
- A signed browser preference controls the welcome screen and expires after 180 days.
  A first-name greeting requires an explicit opt-in during registration and a still-active
  credential. The preference grants no access to the account.
- Registration, revocation, password change, TOTP replacement and security/device management
  require recent strong proof, ten minutes by default. Complete the password plus TOTP or
  passkey prompt, then repeat the action. Proof refreshes only the current session and does
  not extend its expiry. Ordinary catalog/scanning work never refreshes proof or prompts.
- An optional-TOTP office user who never set it up chooses **TOTP-ის ჩართვა**, re-enters the
  current password, adds the authenticator and confirms its code. This ends old sessions;
  only confirmation creates a new one. Then they can register a passkey. An existing
  authenticator uses the protected replacement action with recent proof and a warning.
- Revoke a credential from the security page on the same or another personal device.
  This blocks all synced copies and immediately ends sessions created with that credential,
  including the current session when applicable. Other passkeys and password/TOTP remain
  available. A lost device's welcome page will drop the revoked credential's hint on reload.
- A registered warehouse browser hides and rejects passkeys. Device/PIN sign-in stays as
  before. Do not enroll personal office passkeys on shared phones. Browser registration is
  a logical context; clearing browser data is not a claim of physical hardware trust.

## Production configuration and release gate

Complete this **before starting the new release**, including on upgrades. Keep protected
passwords/keys in the existing service environment; never copy development `.env` over it.
Merge the non-secret settings from `ops/hub.production.env.example`:

```dotenv
WEBAUTHN_RP_ID=app.khidi.app
WEBAUTHN_ORIGIN=https://app.khidi.app
AUTH_RECENT_WINDOW_SECONDS=600
```

1. Load the target service's protected production environment in the release checkout.
   Confirm both required variables are present with the exact values above. Do not print
   the environment or database URLs. Do not set the RP to `khidi.app` or a test subdomain.
2. Run `NODE_ENV=production corepack pnpm ops:check-config` **before switching/stopping
   the current release or starting the new one**. It validates the RP, origin and recent
   window without connecting to PostgreSQL and prints no secret. Abort the release if it
   fails. A deployment automation must run this gate and stop on a non-zero exit code.
3. Follow [server setup](server-setup.md): database, roles, `db:migrate`,
   `media:jobs:deploy`, and bootstrap only on an empty first installation. This release adds
   **0013_office_passkeys.sql**; earlier migrations are unchanged. Use `hub_migrator` for
   migrations, `hub_app` at runtime. Do not run tests or seeds on a shared server.
4. Build in the established isolated build environment; start Hub/worker with the protected
   production environment. Use `NODE_ENV=production corepack pnpm --filter @khidi/hub start`:
   it runs the configuration gate before Next binds a listener. Keep this gate if your service
   uses a custom start command. The instrumentation hook also refuses to prepare the application
   on invalid configuration (Next may retain its process after a hook failure).
   Existing sessions have no recent proof until they complete real strong authentication.
5. Behind unchanged Cloudflare Access, verify password/TOTP fallback first, then enroll a
   personal test passkey on an authorized office account. Log out and sign in with it. Verify
   own-key revocation and password/TOTP fallback. Do not alter Access to make WebAuthn work.
   Access session duration is separate from Khidi session expiry and recent-auth windows.

Local development uses `localhost` and `http://localhost:3100` from `.env.example`; use matching
explicit values for another local port. Production passkeys cannot be moved to localhost or
`camera.khidi.app`. Do not change the production RP to run a camera or browser experiment.

## Recovery and records

Use password/TOTP fallback when a platform credential is unavailable. If those are lost too,
follow [server-only recovery](user-recovery.md), verify the owner, and separately select revoke
all passkeys and all sessions when credentials may be compromised. Key revocation invalidates
sessions issued by those keys even when the separate all-sessions action was declined.
All chosen recovery actions roll back together on failure.

Keep audit actions and internal row references only; never collect raw credential responses,
challenge values, passwords, TOTP setup keys/URIs, or operating-system biometric data in logs,
tickets or screenshots. Names and creation/last-use times are visible only to their owner.

## Passkey recovery guidance

Registration and the account-wide credential list are separate. Any eligible personal
browser can attempt another registration. The operating system chooses how to verify the
user; Khidi does not label synced credentials as physically present on a particular device.

Explicit **Cancel** before verification is shown inline and does not call the verification
endpoint. Retry is a new click and fetches new options. A reported timeout, unsupported
browser, verification rejection, network/server failure and expired recent proof have
different safe messages. A platform `NotAllowedError` or interruption can have multiple
causes; the dialog offers guidance without asserting that the user cancelled or the provider
is disabled. Platform availability is used only as a capability hint. No OS settings link
is guessed. The [Android guide](https://support.google.com/android/answer/14124480) and
[Apple AutoFill](https://support.apple.com/en-us/120758) / [iCloud Keychain](https://support.apple.com/en-us/109016)
describe where to check the manager manually; menu names vary by release/vendor. See the
[WebAuthn recommendation](https://www.w3.org/TR/webauthn-3/) for the overlapping errors.

## Idle expiry and the existing server

[ADR-009](../adr/ADR-009-session-inactivity.md) defines **20 minutes office / 10 minutes
warehouse PIN** idle, with the original **12 hours / 4 hours** absolute limits. Neither
polling, foregrounding the PWA nor queue replay keeps a session alive. Activity is coalesced
every 30 seconds. About a minute before expiry, use **სესიის გაგრძელება** to confirm with the
server or **გასვლა**. At the absolute limit, save manually and sign in again. A disconnected
page at the estimated deadline locks pending a connection; drafts remain in the open page
until the server confirms whether it can continue. On confirmed expiry, sign in again with
passkey or password/TOTP, or with PIN on the shared terminal. Already queued scans/photos
stay on the device with their original owner; unsaved inputs are not stored or auto-submitted.

The running `6997bbe` release already has migration `0013`. For this follow-up, after review:

1. Keep the current release artifact and take the normal pre-update backup. Prepare the new
   release with the same protected environment, DB roles, keys, RP and origin. In the release
   checkout run `NODE_ENV=production corepack pnpm ops:check-config` **before** switching
   the service. No additional environment values or queue deployment are needed for this
   change. Never run tests, seeds or bootstrap on the shared server.
2. Apply pending migrations with `NODE_ENV=production corepack pnpm db:migrate` as
   `hub_migrator`. `0014_session_inactivity.sql` starts one idle window for existing sessions,
   capped by their original absolute deadlines. `0015_passkey_registration_platform.sql`
   adds the optional registration platform and preserves existing credentials and names.
3. Start the reviewed Hub using the gated start command and the existing `hub_app` account.
   Confirm health, then close and reopen the PWA or reload tabs to pick up the new client.
   Smoke-test both login modes before the demo. Cloudflare Access remains independent.

For rollback, stop the new Hub and restart the saved `6997bbe` artifact with the same
environment, **keeping `0014` and `0015` applied**. The old binary ignores idle expiry, so before it
accepts requests, have the authorized database operator expire the sessions that are already
idle under the new policy. Verify the database target in the protected operator session and
run the following while the Hub is stopped. It shortens only already idle sessions; it does
not change passkeys, user accounts, queues or stored data:

```sql
WITH idle AS (
  SELECT id, last_activity_at + CASE WHEN auth_method = 'WAREHOUSE_PIN'
    THEN interval '10 minutes' ELSE interval '20 minutes' END AS idle_deadline
  FROM sessions
)
UPDATE sessions s SET expires_at = idle.idle_deadline
FROM idle
WHERE s.id = idle.id AND idle.idle_deadline <= statement_timestamp()
  AND s.expires_at > idle.idle_deadline;
```

This avoids reactivating idle-expired sessions while restoring the previous release's session
policy for others. Do not drop the column, edit an applied migration, restore over newer
business data or re-enroll existing keys as part of a code rollback.

## Human rollout checklist

The owner confirmed native registration and sign-in on physical Android and iPhone for
`6997bbe`, including restoring Android registration by enabling its provider. Repeat the
checks below on the reviewed follow-up release:

- Android installed PWA: explicit registration without entering a name, fingerprint/device
  PIN verification, logout, quick sign-in, cancellation and fallback. Confirm the list records
  Android. Revoke from another device and check the revoked credential can no longer sign in.
- iPhone installed PWA and Safari: Face ID/Touch ID/passcode, registration and discoverable
  sign-in after reopening, cancellation, reauthentication and password/TOTP fallback.
- Desktop platform authenticator: same flow; multiple automatically named keys, stale proof prompt,
  reauthenticate without extending expiry; revoke the current key and confirm sign-out.
- Shared warehouse phone: registered-device/PIN flow, user switch and scanner work unchanged;
  no passkey creation or sign-in controls/API access while in shared browser/PIN context.
- Optional-TOTP OPERATOR/ORDER_MANAGER: password-confirmed first setup, valid-code confirmation,
  explicit passkey enrollment. Existing TOTP cannot be reset through first setup.
- On a disposable device/account, disable or change the credential manager, check the cautious
  help and retry after restoring it. Confirm app Cancel is inline and retry opens a fresh prompt.
- Office/warehouse: leave a form or scanner open, confirm a warning about 60 seconds before
  20/10 minutes, continue while online, then let a session expire and sign in again. Check
  app background/resume, two tabs, temporary loss of network, and retained scan/photo queues.

Automated cryptographic and browser-flow tests do not certify physical OS prompts or
cross-device sync. No automatic deployment or merge is part of this task.

## Implementation verification — 2026-11-05

Branch `feat/office-passkeys` starts at merged `main`
`57c4afd1decfd844d3da6c365ee882ab2d6fd456` (TOTP PR #8). Schema change:
`0013_office_passkeys.sql`; no earlier migration was edited. Scope includes auth/session
services, self-service security UI/API, interactive recovery, deployment configuration and
tests. The source changes are split into backend, UI, test-fixture and documentation commits.

`pnpm typecheck`, `pnpm lint` (including dependency boundaries) and `pnpm build` passed.
Full-suite verification uses disposable PostgreSQL **18.4** on `127.0.0.1:5548`, with explicit
restricted-app/migrator URLs to `khidi_passkeys_verified_test`: fresh migrations/seeds and a
repeat run. Each completed run reports **316 passed**, with the existing optional S3 integration
test skipped because MinIO is not configured. No tests or seeds ran on a shared database.
Successful exact-production configuration preflight was checked; a parent-domain RP failed
both preflight and the gated Hub `start` command with exit code 1 before Next started.

Synthetic ES256 fixtures exercise the actual library verifiers and signatures, including
forgery, RP/origin/UV, user/session binding, expiry, duplicate credentials, concurrent replay,
counter regression, revocation, recent-proof persistence, recovery rollback, and first optional
TOTP enrollment. API tests cover cookie flags, generic public failures, CSRF and shared/PIN denial.

Built local React UI was exercised at `http://localhost:3112` against a separate
`khidi_passkeys_ui_test` database: password/TOTP sign-in, explicit enrollment offer, stale-proof
denial, password/TOTP reauthentication, rename persisted after reload, confirmed revocation,
navigation and a 390 × 844 layout. Key management used a **server-created synthetic fixture**;
no real platform credential was created. Registering that local browser as a warehouse terminal
hid key controls; logout showed the registered-terminal/PIN flow and no passkey sign-in button.
The test tab/server were closed, temporary viewport reset and local device cookie removed.

The browser tool does not support the WebAuthn virtual-authenticator command. Consequently
native registration/sign-in prompts, biometrics, platform sync and physical Android/iPhone
installed-PWA checks remain pending in the checklist above. Cryptographic tests are not
represented as physical-device testing.

One verification-only deviation: `packages/media/src/upload.test.ts` previously chose an
arbitrary SKU with unordered `LIMIT 1`; a rerun selected a SKU archived by an earlier test and
failed Class A review resolution. Its fixture now filters out archived SKUs. This changes no
application logic, seed contents or real catalog data.

## PR #9 follow-up verification — 2026-11-05

- `pnpm typecheck`, `pnpm lint` (including dependency boundaries), and production build
  passed. Rebuilt the Hub after the final dialog focus and privacy styling adjustments.
- Full `pnpm test` twice (fresh PostgreSQL 18.4 `khidi_idle_verified_test`, then rerun):
  **344 passed each**, one existing optional S3 test skipped (MinIO was not configured).
  Coverage includes delayed and concurrent heartbeats, absolute expiry, no passive
  renewal, tab identity, independent strong proof, passkey/PIN re-entry, safe error
  classification, fresh retry and cancellation without verification.
- On separate `khidi_idle_ui_test`, migrated a populated `0013` database to `0014` using
  the migration runner; all 13 previous migrations were skipped and the old session's
  absolute deadline was unchanged. Tested the rollback SQL there: an idle session stayed
  expired, the active session retained its deadline, and both test passkeys were intact.
- Local Chrome, built UI: signed in with password/TOTP, saw two synthetic keys alongside
  the enabled add form, interrupted the local server to exercise registration feedback,
  retried explicitly and closed with Escape without losing the entered name. Verified
  the idle warning, server-confirmed Continue and automatic navigation to login with an
  expiration notice. A real near-deadline response exposed a scheduling race; fixed it
  and added a regression test. No real platform passkey was created in the browser.
- Native provider-disabled behavior, biometrics, platform sync and installed-PWA return
  on this build still require the physical-device checklist above. Browser simulation
  and synthetic signatures are not evidence of native OS behavior. The running deployment
  and its credentials were untouched.

## Quick sign-in follow-up

- Verified in local Chrome with a disposable account: welcome and password screens,
  password plus TOTP, the post-login offer without a naming field, the optional first-name
  checkbox, and the Android entry and revocation confirmation at a 375 px viewport. The
  Android entry used a synthetic credential; repeat native checks on physical devices.
- Automated tests cover automatic names, rejected consent-cookie tampering, expiry, account
  switching and offer suppression, and credential revocation from a separate office session.
  Revocation invalidates both sessions opened by that credential and leaves another user's
  credential usable.

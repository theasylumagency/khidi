# Khidi office passkeys

Office users may add platform passkeys from **ანგარიშის უსაფრთხოება** after password plus
TOTP sign-in. Registration is always an explicit action; canceling the operating system prompt
leaves the account unchanged. A passkey may sync through iCloud Keychain, Google Password
Manager or another platform provider. It identifies the user, not a trusted physical device.
Khidi never receives fingerprint, face or device-PIN data. See [ADR-008](../adr/ADR-008-office-passkeys.md).

## User paths

- After a strong password/TOTP login, a supported platform with no registered passkey offers
  **ამ მოწყობილობაზე სწრაფი შესვლის ჩართვა**. The account screen lets the user add several
  named passkeys, see creation/last-use times, rename and revoke their own credentials.
- **Passkey-ით შესვლა** uses discoverable credentials; no email lookup is exposed publicly.
  Cancel or failure leaves password/TOTP fallback available. Account existence, revocation
  and internal verifier errors share one anonymous failure message.
- Registration, rename/revoke, password change, TOTP replacement and security/device management
  require recent strong proof, ten minutes by default. Complete the password plus TOTP or
  passkey prompt, then repeat the action. Proof refreshes only the current session and does
  not extend its expiry. Ordinary catalog/scanning work never refreshes proof or prompts.
- An optional-TOTP office user who never set it up chooses **TOTP-ის ჩართვა**, re-enters the
  current password, adds the authenticator and confirms its code. This ends old sessions;
  only confirmation creates a new one. Then they can register a passkey. An existing
  authenticator uses the protected replacement action with recent proof and a warning.
- Revoking a passkey immediately ends sessions created with that credential, including the
  current session when applicable. Other passkeys and password/TOTP remain available.
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

## Human rollout checklist (pending)

- Android installed PWA: explicit registration, fingerprint/device PIN verification, logout,
  passkey sign-in, cancellation, fallback, rename and revoke; no password or OTP correction.
- iPhone installed PWA and Safari: Face ID/Touch ID/passcode, registration and discoverable
  sign-in after reopening, cancellation, reauthentication and password/TOTP fallback.
- Desktop platform authenticator: same flow; multiple named keys, stale proof prompt,
  reauthenticate without extending expiry; revoke the current key and confirm sign-out.
- Shared warehouse phone: registered-device/PIN flow, user switch and scanner work unchanged;
  no passkey creation or sign-in controls/API access while in shared browser/PIN context.
- Optional-TOTP OPERATOR/ORDER_MANAGER: password-confirmed first setup, valid-code confirmation,
  explicit passkey enrollment. Existing TOTP cannot be reset through first setup.

Automated cryptographic and local virtual-authenticator tests cover application behavior;
they do not certify physical device prompts or cross-device sync. No automatic deployment or
merge is part of this task.

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

# Desktop sign-in using a phone

Office users who already enabled Khidi quick sign-in on a phone can use that
passkey from a supported desktop browser. The login page now exposes **სწრაფი
შესვლა** in a fresh personal browser; a remembered-account cookie only controls
button priority and the consented name greeting. An available local fingerprint
reader, Windows Hello enrollment or a locally stored passkey is not a prerequisite.

Choose quick sign-in, then the phone/other-device option in the browser's native
dialog. Scan its QR code if shown and confirm with the phone's screen lock. Keep
both devices online, nearby and with Bluetooth enabled. Exact wording, device
linking and whether another QR scan is needed depend on the browser, operating
system and passkey provider. Khidi does not promise an automatic push notification.
The collapsed Georgian help explains this on the login page.

This reuses the accepted [ADR-008](../adr/ADR-008-office-passkeys.md) implementation:
discoverable WebAuthn sign-in, required user verification, a short-lived challenge
bound to the requesting browser, and signature verification before session creation.
The existing two application requests handle a successful sign-in. There is no new
worker, polling loop, push service, database schema, dependency or authentication
policy. Shared warehouse browsers retain PIN login and cannot use passkeys.
Password/TOTP remains available, including after a cancelled native prompt.

## Verification

Validation on 2026-11-17:

- Monorepo typecheck, lint (including dependency boundaries) and production build
  passed. Hub typecheck also passed after adding the UI regression cases.
- Full suite on a fresh isolated PostgreSQL database: **698 passed**, one optional
  MinIO integration test skipped. The added signature regression uses a synthetic
  phone registration and cross-platform assertion from a fresh anonymous browser;
  it also rejects a different browser binding and missing user verification.
- Six additional focused UI renderer tests passed: fresh and remembered browsers,
  warehouse exclusions, unavailable WebAuthn and insecure contexts. These execute
  the capability effect synchronously without claiming to test browser hydration.
- Production HTTP smoke passed: health/database, login HTML/security headers,
  compiled client asset, unauthenticated redirect, missing/forged session rejection
  and API host isolation. An initial smoke configuration was correctly rejected
  for using a development-pattern database credential; the synthetic production
  fixture was corrected without changing application validation.
- Headless Chromium could not start because this environment forbids its required
  local socket. Real browser layout and native phone/QR verification remain pending.

Physical-device acceptance after deployment:

1. On a desktop browser without a remembered Khidi account, open `/login` and
   choose **სწრაფი შესვლა**. Use the phone that already has the Khidi passkey.
2. Complete the browser's phone/QR flow. Confirm that the expected account opens
   without entering a password or TOTP, then sign out.
3. Repeat with Android/Chrome and iPhone/Safari as available. Cancel once and
   confirm password/TOTP remains usable. These physical Bluetooth/QR interactions
   cannot be certified by the synthetic authenticator or headless browser checks.

References:
- [Google: cross-device passkey sign-in](https://developers.google.com/identity/passkeys/use-cases)
- [Google: supported environments](https://developers.google.com/identity/passkeys/supported-environments)
- [FIDO Passkey Central: cross-device sign-in](https://www.passkeycentral.org/design-user-journeys/optional-patterns/cross-device-sign-in)

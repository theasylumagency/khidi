# ADR-008 — Office passkeys and recent strong authentication

Status: Accepted — explicit task-3 decisions; first optional TOTP enrollment approved by the owner on 2026-11-05.

## Context

Office users need convenient sign-in without lowering the security of password plus TOTP.
Warehouse shared browsers retain device registration plus personal PIN. A synced passkey
identifies a user; it does not establish trust in a physical device.

## Decision

- Use `@simplewebauthn/server` **14.0.3** (published 2026-09-25) and
  `@simplewebauthn/browser` **14.0.0** (2026-09-02), pinned exactly. Both exceed the
  two-week minimum at implementation. Library verifiers parse authenticator data and
  verify signatures, presence, user verification, RP/origin and counter progression.
- Production RP is exactly `app.khidi.app`, origin `https://app.khidi.app`, RP name
  **Khidi**. Configuration is mandatory in production; localhost is a separate development
  RP. Parent domains, alternative production hosts and HTTP production origins fail closed.
  Changing the RP would invalidate credentials. Check configuration before deploying and
  again during Node server startup; do not infer origin from proxy/request headers. The Hub
  `start` script runs the pure check before Next opens a listener, as Next's instrumentation
  failure alone can leave the process running with an unprepared application.
- Explicitly initiated platform registration uses discoverable resident credentials,
  `userVerification: required`, and attestation `none`. Login is discoverable and does not
  look up an email publicly. Credentials can sync via the user's platform provider. No
  biometric or device-PIN data reaches Khidi. Never create a passkey automatically.
- Registration and reauthentication challenges bind the user, current session and ceremony.
  Anonymous sign-in binds the browser and ceremony; the verified credential and user handle
  determine the user. Challenges live for five minutes; only challenge and random browser
  binding **hashes** are persisted. The binding cookie is HttpOnly, SameSite Strict and
  Secure in production. Security POSTs require the configured Origin and JSON content type.
- Lock user, session, challenge and credential in a consistent order. Challenge consumption,
  verification result, counter/session writes, audit and outbox commit atomically. A failed
  cryptographic attempt consumes its challenge and commits a safe failure record. A replay,
  expired or cross-session/cross-user challenge cannot create or strengthen a session.
- Store credential ID, public key, counter, transports, backup flags, user-chosen name,
  timestamps and revocation. PostgreSQL forbids credential rebinding, identity/key replacement,
  counter reduction, revocation reversal and runtime DELETE. User-facing lists omit raw IDs
  and keys. Public failures use one generic response. Audit stores actions and internal row
  references, never challenge values, credential responses, passwords or TOTP material.
- Successful passkey login creates a normal 12-hour `OFFICE_PASSKEY` session. It references
  its source credential: self-revocation deletes those sessions; recovery revocation also
  makes them invalid immediately, even if separate all-session revocation was declined.
  Password/TOTP fallback remains available. Inactive or pending-enrollment users cannot log in.
- Persist `sessions.last_strong_auth_at`, set only by successful password **and** TOTP or
  verified passkey user verification. Existing sessions are not backfilled from creation or
  activity time. Recent proof defaults to ten minutes (`AUTH_RECENT_WINDOW_SECONDS`, 1–3600).
  Reauthentication updates the existing session's proof time without extending its expiry.
  PIN sessions never qualify. Require recent proof for passkey registration/rename/revocation,
  password change, TOTP replacement, device management and storefront API-key issuance.
  Catalog/scanning work is unaffected. Invalid password/TOTP proofs retain atomic lockouts.
- An OPERATOR/ORDER_MANAGER who has never enabled TOTP may opt in by re-entering the
  password, then confirming TOTP through the existing guided enrollment. This is the owner's
  explicit clarification. Existing TOTP requires recent strong proof plus password to replace;
  first-setup cannot disclose or replace an existing secret. Starting either enrollment
  revokes old sessions so they cannot survive the pending-enrollment boundary.
- Recognized registered warehouse browsers (including revoked device tokens) and warehouse
  PIN sessions cannot register/use/manage passkeys. This is a browser context check, not an
  assertion of physical device binding after browser data is cleared. The shared-phone UI
  retains PIN sign-in and hides passkey actions.
- Extend interactive server-only recovery with a separately confirmed revoke-all-passkeys
  action. It shares the existing transaction, audit, operator-note and final-email confirmation.
  Failure rolls back all selected changes. No recovery HTTP route is added.

## Authentication and idempotency

Authentication ceremonies intentionally follow the existing authentication transaction pattern
rather than generic `executeIdempotent`: returning a stored auth response could reissue a session
or retain a plaintext TOTP enrollment secret; throwing inside an outer idempotency transaction
would roll back failed-attempt counters and challenge consumption. Single-use WebAuthn proofs,
session-bound operations and the enrollment boundary provide replay protection for these flows.
This is a scoped exception to AGENTS.md §5, following the explicit authentication task.

Rename, revoke and password changes use `executeIdempotent` scoped to user **and session**,
with the provided transaction. A domain-separated HMAC derived from the existing encryption
key fingerprints sensitive request content so the idempotency table never holds plaintext or
an unkeyed fast password digest. Audit/outbox and changes remain one domain transaction.

## Consequences and validation

Cloudflare Access is unchanged: it remains an outer gateway, not the Khidi user identity.
Its session duration is configured independently. Losing all passkeys requires password/TOTP
fallback or the established authorized server recovery. Keep a second verified administrator.
No new public URLs contain company names; no migrations or seed fixtures are rewritten.

Tests use synthetic ES256 registration/assertion signatures and isolated `_test` databases,
including concurrent replay, origin/RP/UV failures, ownership, revocation, stale proof, expiry
preservation, self-enrollment, configuration and recovery rollback. Physical Android/iPhone
platform and installed-PWA behavior must be checked by the owner before rollout; a virtual
authenticator cannot certify biometrics or platform sync.

References: [server verifier](https://simplewebauthn.dev/docs/packages/server),
[browser ceremonies](https://simplewebauthn.dev/docs/packages/browser).

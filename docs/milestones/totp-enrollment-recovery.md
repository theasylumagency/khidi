# TOTP enrollment and server-only recovery

Date: 2026-11-04. Branch: `feat/totp-enrollment-recovery`, based on merged `main` at
`cfc8351d9c452e797102a2a243162d3f1e616da1` (camera PRs #6 and #7 merged).

## Behavior

- Three Georgian enrollment steps: add, confirm, complete. Desktop shows the QR first;
  mobile prioritizes the same-device authenticator link with QR/copy/manual-key fallbacks.
  QR uses the existing ZXing encoder and exactly the server's OTPAuth URI; no dependencies
  were added. The password, setup key, QR and code leave UI state on completion.
- No session until valid confirmation. Password-verified refresh reuses pending enrollment;
  the explicit confirmed restart rotates it and writes an audit/outbox event. Confirmed
  secrets are never exposed by normal APIs. All office-login responses are `no-store`.
- `ops:recover-user` uses an explicit migrator connection and real terminal, accepts no
  arguments or credential environment inputs, reads passwords without echo, confirms each
  action and requires an operator note plus retyped email. Its transactional core has no I/O.
  Password/TOTP/session changes, audit and outbox commit together or all roll back.
- Recovery preserves the security floor for mandatory and formerly TOTP-enabled office
  users. An optional-TOTP user who never configured it, and warehouse-only users, are not
  offered TOTP reset. Pending office enrollment cannot create a PIN session either.
  Existing ordinary password/TOTP, registered-device/PIN and RBAC checks remain green.

New migration: `0012_totp_enrollment_recovery.sql`. It expands the pending-enrollment
constraint to password-based office accounts and backfills `totp_ever_enabled` from current
enabled state/completion audit history. Migration 0011 and all other applied migrations are
unchanged. Login rechecks the locked credential/enrollment state before issuing a session,
so a concurrent recovery or restart cannot authenticate an old credential snapshot.

## Verification

- `corepack pnpm typecheck`, `corepack pnpm lint` (including `check:boundaries`) and
  `corepack pnpm build`: pass.
- Full `corepack pnpm test` twice, fresh `khidi_totp_security_final_test` then re-run on
  PostgreSQL 18.4: 260 pass, 1 optional S3 test skipped per run (MinIO is not running).
  Filesystem media tests and real PostgreSQL worker tests run. Recovery fixtures verify
  both `_test` URLs and the actual database name, then use temporary shadow tables.
- Recovery tests inject audit failure after password/TOTP/session changes and prove no
  partial change or audit remains. Fake-TTY wrapper tests cover gating, action eligibility,
  confirmation and redacted errors; a real readline test verifies password echo suppression.
  The real CLI also refused non-interactive `NODE_ENV=production` before connecting.
- Local production-build browser check used only synthetic credentials in separate
  `khidi_totp_ui_test`: desktop QR, 390 × 844 mobile flow, invalid code, explicit audited
  restart, refresh preserving the key, `no-store` and no cookie before confirmation,
  completion removing the key/link/QR from DOM, and authenticated continuation. No console
  errors or horizontal overflow. No real authenticator app/deep-link handler was launched.

Real Android/iPhone installed-PWA authenticator/QR/clipboard behavior remains an owner check
before deployment. No shared server, production data/configuration, seed content, camera
workflow, offline queue or passkey implementation was changed. No automatic deployment or
merge. Per the owner's confirmed sequence, passkeys start only after this PR is merged.

## Documentation and implementation choices

No business-rule deviations or new ADR. ADR-003 adds the authorized enrollment/recovery
rules; `docs/ops/server-setup.md` links the new `docs/ops/user-recovery.md` procedure and
second-ADMIN recommendation. This report is new. The historical TOTP flag is necessary to
keep a formerly TOTP-enabled optional user's security floor after clearing its current secret.
Lockout timers are retained. Session revocation remains a separately confirmed choice.

## Changed files

```text
apps/hub/src/app/api/auth/office-login/office-login.test.ts
apps/hub/src/app/api/auth/office-login/route.ts
apps/hub/src/components/login-forms.tsx
apps/hub/src/components/office-login-form.css
apps/hub/src/components/office-login-form.tsx
apps/hub/src/components/totp-enrollment.test.tsx
apps/hub/src/components/totp-enrollment.tsx
docs/adr/ADR-003-custom-database-session-and-device-auth.md
docs/milestones/totp-enrollment-recovery.md
docs/ops/server-setup.md
docs/ops/user-recovery.md
ops/recover-user.ts
package.json
packages/auth/src/bootstrap.ts
packages/auth/src/index.ts
packages/auth/src/password-policy.ts
packages/auth/src/recovery-console.test.ts
packages/auth/src/recovery-safety.ts
packages/auth/src/recovery.test.ts
packages/auth/src/recovery.ts
packages/db/migrations/0012_totp_enrollment_recovery.sql
packages/db/src/client.ts
packages/db/src/schema.ts
packages/domain/src/index.ts
packages/i18n/src/index.ts
packages/products/package.json
packages/products/src/labels.test.ts
```

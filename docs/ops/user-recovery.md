# Khidi TOTP enrollment and server-only user recovery

## Enrollment

Office login keeps its email/password/TOTP model. An account marked for enrollment gets no
session until it confirms a valid six-digit code. The three steps are add, confirm, complete.
On a phone, open the authenticator on the same device; if the app does not handle `otpauth:`,
copy the Base32 key or show the QR on another device. Desktop makes the QR primary. The QR
encodes exactly the server-generated OTPAuth URI with issuer **Khidi**, using the repository's
existing ZXing encoder; no external QR service or new dependency is involved.

Refreshing and signing in again with the password returns the same unfinished enrollment.
Only the explicit, confirmed start-over action replaces that key and records
`TOTP_ENROLLMENT_RESTARTED`. This action cannot reset an already enrolled account. Successful
confirmation clears the setup key, QR, password and code from UI state. Enrollment responses
are `no-store`; the browser never persists the secret, and normal login responses never return
an enrolled secret. Encrypted-at-rest storage, five-attempt lockout and gateway remain in place.

Migration `0012_totp_enrollment_recovery.sql` expands pending enrollment to password-based
office accounts (`ADMIN`, `STOCK_MANAGER`, `OPERATOR`, `ORDER_MANAGER`). It records whether
TOTP has ever been enabled, so recovering an optional-TOTP user cannot silently lower their
security level. Existing migration 0011 is unchanged. Warehouse-only PIN users are excluded.

## Before pilot

Create a **second ADMIN account** belonging to a different trusted person, or a sealed
break-glass account with securely stored, separate password and authenticator material.
Verify its sign-in before pilot. Normal recovery should not depend on one person's phone or
on emergency server access. The bootstrap command is only for an empty database; never
delete users or run development seeds to create this second account.

## Break-glass recovery

Only an authorized server operator with access to the protected production configuration and
the database migrator credential may run this. Verify the account owner's identity through
the organization's established process first. There is no recovery HTTP endpoint, bypass
token, non-interactive production mode or password-from-environment option.

1. Use a private, interactive server terminal in the correct release checkout. Do not record
   the session. Confirm the selected database through the protected service configuration;
   do not paste connection strings or secrets into tickets or shell history. Apply the normal
   migrations before running this version of the tool; never run tests or seeds on the server.
2. With the production environment loaded and `DATABASE_MIGRATOR_URL` explicitly configured:

   ```sh
   NODE_ENV=production corepack pnpm ops:recover-user
   ```

   The command accepts **no arguments** and requires both input and output to be terminals.
   It uses a dedicated migrator connection, not the runtime `DATABASE_URL`/pool. It never
   prints a driver error that could contain a connection string or bound secret.
3. Enter the target email. Inactive or nonexistent accounts are refused. Select each action
   separately by typing `YES`:
   - Reset TOTP: offered for office ADMIN/STOCK_MANAGER accounts and office users who have
     or previously had TOTP enabled. Clears the current secret and forces confirmed enrollment
     on the next login; never offered to warehouse-only users or an optional-TOTP user who
     never configured it.
   - Change password: offered only for an existing office login. Enter it twice without echo;
     the existing policy is at least 12 characters and at most 72 UTF-8 bytes.
   - Revoke all user sessions: includes office and warehouse sessions for that user. Select
     this whenever a device or credential may be compromised. Password/TOTP changes do not
     implicitly select this separately confirmed action.
4. Enter a mandatory operator note describing authorization and the incident, **without any
   password, TOTP key, QR/OTPAuth URI or other secret**. Retype the target email to commit.
   Cancellation, mismatched confirmation, invalid input or any transaction failure leaves
   no partially applied recovery. At least one action must be selected.
5. All selected changes, `USER_RECOVERY_PERFORMED` audit row and outbox event commit together.
   The record identifies the target user, selected actions, revoked-session count and note;
   it contains no password/hash, secret or QR. The server operator is not impersonated as a
   signed-in Hub user (`actor_user_id` is null). Existing brute-force lockout timers remain
   in force; wait for an active lockout to expire before trying the recovered account.
6. The owner signs in normally with the resulting password. After a TOTP reset, they enroll
   a new authenticator and confirm it before receiving a session. Check the audit record.
   Do not use bootstrap, change authentication rows manually or clear the users table.

If a terminal disconnects around commit, inspect the audit before repeating the procedure;
do not assume that missing terminal output proves rollback. The command does not change
roles, memberships, entities, storefronts, registered devices, PINs, settings or seed data.
Passkey revocation is intentionally left to the separate passkey task.

## Local trials and automated tests

Outside production the interactive command accepts only an explicit PostgreSQL URL to
`localhost`, `127.0.0.1` or `::1`, with a database name ending in `_dev` or `_test`. Remote
or unsuffixed databases require `NODE_ENV=production` and still require a real TTY. Malformed
URLs, hidden connection overrides and overlong database names fail closed. There is no override.

Automated tests always use a dedicated `_test` database, never a shared server. Recovery
fixtures check both test environment URLs **and** `current_database()` before mutation and
use temporary shadow tables rather than modifying seeded or existing users. Wrapper tests
inject fake terminal/services; one exercises real readline echo suppression. Integration
tests inject an audit failure after password/TOTP/session changes to prove rollback.

Real-device checks remain manual: Android installed PWA (deep link, desktop QR, confirmation),
iPhone (QR and available deep-link handler), desktop QR, and warehouse registered-device/PIN
regression. Confirm clipboard fallback, unfinished refresh and explicit start-over too.

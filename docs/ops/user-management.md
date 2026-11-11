# User management (M11 H9)

The owner added H9 to M11: there are no existing staff accounts to migrate; only the first
ADMIN exists. All newly created office accounts require confirmed TOTP, including OPERATOR
and ORDER_MANAGER. ADR-001's single global role and entity memberships remain unchanged.

1. Sign in as ADMIN and open **მომხმარებლები**. Every change requires recent strong proof;
   if prompted, confirm with password/TOTP or an existing passkey, then repeat the action.
2. Enter the employee's name, office email (office only), one role, memberships and permissions.
   WAREHOUSE has one membership and no office permissions. For an accountant choose an office
   role and explicitly grant reports.view. Review the base permissions of that role first.
3. Copy the generated setup link and hand it privately to that employee. Khidi sends no email.
   The administrator never chooses or sees their password/PIN. The raw link appears once, is
   held only in the page's memory and is absent from audits, outbox events and idempotency receipts.
4. The employee opens it behind the app gateway. A random 256-bit token is carried in the URL
   fragment, not the HTTP URL/query; the page removes the fragment from history. Do not forward
   screenshots or paste it into logs. An existing signed-in user must explicitly sign out first.
5. Office: set and confirm a password, then complete the existing guided authenticator setup
   and verify a code. No session exists until that confirmation. Warehouse: open the link on an
   active registered terminal, set/confirm a 4–6 digit personal PIN, then sign in normally.

Links expire after 72 hours by default. The ADMIN can change the hours on the users screen;
the setting is audited and affects newly issued links only. Reissuing an unused/expired link
revokes its predecessor. An already enrolled employee needs the explicit credential-reset action.
If a raw-link response is lost, a repeated idempotency request returns metadata only; issue a
new unused link from the user row. Do not attempt to recover a raw token from the database.

Role, membership, permission or email changes revoke all sessions and unused links; the report
access screen uses the same strong-authentication/revocation rules. Moving between office and
warehouse also clears incompatible credentials, revokes passkeys and issues the matching setup.
Deactivation revokes sessions (and their push subscriptions) and unused links immediately.
Stored passkeys and TOTP remain but are unusable while inactive. Reactivation restores neither
sessions nor links. Users are never deleted. An ADMIN cannot demote or deactivate themselves;
the last active ADMIN is also protected by a database trigger.

Credential reset is explicit: sessions, passkeys and old links are revoked; the employee sets a
new password and enrolls TOTP again, or sets a new warehouse PIN on a registered terminal.
Do not use reset to rotate your own credentials: use account security. The interactive
ops:recover-user command remains the operator's break-glass path if no administrator can sign in.

Setup redemption follows ADR-008's authentication-ceremony exception to generic response replay:
the single-use token is consumed under the user/link locks in the same transaction as credentials,
audit and outbox. Neither passwords nor authenticator secrets are stored in idempotency responses.
Administrative changes use executeIdempotent and store metadata only. Concurrent redemption has
exactly one winner. Revoked, reused, expired and unknown links have the same public failure text.

Before pilot: create the second ADMIN here, have them finish TOTP and independently sign in,
then verify recovery access. The owner checklist includes office and registered-warehouse setup
on Android/iPhone; automated tests cannot certify the platform password manager or gateway.

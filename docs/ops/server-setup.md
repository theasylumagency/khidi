# Khidi — shared server setup

**Never run development seeds or the test suite on a shared server**, including staging.
Seeds contain development accounts, fixed credentials and example reference data. Setting
`NODE_ENV=test` on a server is not a setup step. Use a developer machine or an isolated CI
runner with a dedicated `_test` database for automated tests, including recovery test clones.

## First installation

Use Node.js 24 and the pinned pnpm version. Supply production configuration through the
service's protected environment or an owner-readable `.env`; do not copy development
secrets from `.env.example`. Export `NODE_ENV=production` for every setup command. Keep
the app and worker stopped until the following sequence is complete:

Before the new version starts (also on upgrades), merge the non-secret WebAuthn values from
`ops/hub.production.env.example` into that protected environment. Run
`corepack pnpm ops:check-config` with `NODE_ENV=production` **before switching/stopping the
current release**; abort deployment if it fails. Production requires exactly
`WEBAUTHN_RP_ID=app.khidi.app` and `WEBAUTHN_ORIGIN=https://app.khidi.app`. See the complete
[passkey release gate and device checklist](office-passkeys.md). Cloudflare Access and its
independently configured session duration are unchanged.

1. **Create the database**, with an infrastructure account and a fresh migrator credential.
   Use its real production name, without `_dev` or `_test`. Provision backups before intake.
2. **Provision roles**. Run `docker/postgres/init-roles.sh` with `POSTGRES_USER`,
   `POSTGRES_DB` and `HUB_APP_DB_PASSWORD` supplied securely. The selected database now
   receives CONNECT/USAGE for `hub_app`; the script no longer assumes a fixed database name.
   PostgreSQL's administrator provisions `hub_migrator` and its ownership separately.
3. **Run migrations**: `corepack pnpm db:migrate`. `DATABASE_MIGRATOR_URL` identifies
   `hub_migrator`; `DATABASE_URL` identifies the restricted `hub_app` role on the same DB.
4. **Deploy worker queues**: `corepack pnpm media:jobs:deploy`. This creates/migrates
   pg-boss as `hub_migrator`, registers the media, evidence AI and reservation-expiry queues, and grants runtime
   privileges to `hub_app`. Keep `AI_PROVIDER=disabled` on shared servers. Local fixture runs
   can use `AI_PROVIDER=synthetic`. `AI_DAILY_BUDGET_USD_MICROS` defaults to zero, counts
   reserved and billed amounts, and resets at midnight in `Asia/Tbilisi`.
5. **Create the first administrator** in a private interactive terminal:

   ```sh
   corepack pnpm ops:bootstrap-admin
   ```

   The command requires `NODE_ENV=production`, a terminal and zero extra arguments.
   Enter email, name and a unique password interactively; password and confirmation are
   read without echo. Account credentials are never accepted from CLI arguments or env.
   Passwords require at least 12 characters and at most 72 UTF-8 bytes (bcrypt's limit).
   Do not record the terminal. This is an infrastructure command, not an HTTP endpoint.

Bootstrap works **only when the users table is empty**, including inactive users. A table
lock serializes concurrent attempts. It creates exactly one ADMIN with no PIN, no enrolled
TOTP secret and a mandatory-enrollment flag; an audit row and outbox event commit with it.
It never creates legal entities, storefronts, memberships, devices or system settings and
never resets an existing account. Do not clear users to make it run on an existing server.

On first login, the password-authenticated user must add the displayed Khidi setup key to
an authenticator and submit a valid six-digit TOTP code. No Hub session is issued before
confirmation. Enrollment secrets/passwords are absent from audit/outbox records. After
enrollment, every ADMIN login requires password plus TOTP. Configure legal entities,
storefronts, settings and devices through the authenticated admin UI, never via seed scripts.

Before pilot, create and verify a second ADMIN so losing one authenticator cannot lock out
the organization. See [TOTP enrollment and server-only recovery](user-recovery.md) for the
guided setup, fallback options and audited interactive `ops:recover-user` procedure.

Configure media storage, backups and the deployment gates in [media-storage.md](media-storage.md)
and [backup-restore.md](backup-restore.md) before starting real intake. Start Hub and worker
with `hub_app`, protected production secrets and the same media storage configuration.

## Developer seeds and incident follow-up

Both seed functions fail with `SAFETY:` **before creating a DB client** when
`NODE_ENV=production`, either DB URL is missing/malformed/ambiguous, or either explicit
database name lacks the `_dev`/`_test` suffix. Names exceeding PostgreSQL's 63-byte limit
are rejected. There is no override. Root commands load `.env` without printing its contents;
the test guard still separately requires `NODE_ENV=test` and both `_test` names.

New local setups use `agrotrade_hub_dev` in `.env.example`/Compose. Existing developer
databases with an unsuffixed name must be migrated to a dedicated dev database before
seeding; do not rename or alter a shared database to bypass the guard.

These changes do not remove accounts previously introduced on a shared server. The owner
must inventory them, revoke their sessions and deactivate any development accounts through
the established administration process. Bootstrap refuses that non-empty server. No shared
data or production `.env` is modified by this implementation.

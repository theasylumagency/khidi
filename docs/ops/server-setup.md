# Khidi — installation, upgrade and recovery

Never run seeds or tests on a shared server, including staging. Seeds contain development
accounts and reference fixtures. A _test suffix is necessary for automated tests but does
not authorize tests on a shared database. Use a separate local/CI environment instead.
Do not remove real users or reference data to make bootstrap work.

## Ordered installation

1. **Release and private configuration.** Use Node.js 24, the pinned pnpm and exact locked
   dependencies. Install with corepack pnpm install --frozen-lockfile in a release directory.
   Review ops/hub.production.env.example and supply fresh secrets through protected service
   configuration, outside Git and outside the web root. Keep NODE_ENV=production on every
   shared-server command. Set AI_PROVIDER=disabled; M11 introduces no live AI provider.
   Keep app and worker stopped until migrations and queues are ready. Build artifacts in CI;
   never run the test suite as a deployment step on this server.
2. **DNS/TLS and network.** Configure app.khidi.app and api.khidi.app with valid TLS and the
   application's security headers. Bind Node and PostgreSQL to loopback/private networking;
   block direct public access to their ports. Reject unknown hosts in the proxy default host.
   Cloudflare Access protects the app host only, including login/setup and private APIs.
   Never put Access redirects on the server-to-server API host. ADR-002 exempts only
   /manifest.webmanifest, /sw.js and /icons/* from interactive gateway redirects. Verify PNG
   icons, credentialed manifest fetch, service worker updates and camera over HTTPS.
3. **Reverse proxy.** On the app host refuse /api/v1/storefront/*; on the API host expose only
   that prefix and refuse everything else, including login and health. Preserve actual Host;
   never use a client-supplied forwarded host as authorization. Configure trusted CDN real-IP
   ranges explicitly, then overwrite X-Khidi-Client-IP and X-Khidi-Proxy-Token with the verified
   address and a new random token of at least 32 characters. Strip incoming copies on both
   hosts. Keep the proxy token in a protected include, never in logs. See storefront-api.md.
4. **Request and login limits.** Configure the proxy before accepting traffic. Authentication
   POSTs (including setup and passkey ceremonies) need per-IP rate limiting, for example an
   nginx limit_req_zone on binary_remote_addr at 10r/m with burst 10 and a 429 response.
   Apply a separate general API limit; the Hub also enforces per-key storefront rate windows
   and five-attempt account/PIN lockouts. Trust real-IP headers only from approved proxy ranges.
   Set client_max_body_size 1m normally, 64k for /api/v1/storefront/ and authentication (the
   app uses 16 KiB login, 64 KiB passkeys, 4 KiB setup/activity limits), 8m for /api/prices/csv,
   and 16m for /api/media/uploads and /api/evidence multipart bodies. Include matching proxy
   headers in every nested nginx location; child locations do not inherit sibling settings.
   Limit body/header read time (e.g. 15s), header sizes and upstream timeouts; leave application
   streaming limits enabled. Do not log request bodies, Authorization/Cookie headers, setup
   tokens, private signed media query strings or credential arguments. Log sanitized path,
   response status and request/correlation ID. Keep private responses no-store.
5. **PostgreSQL 18 and roles.** Create the real production database and hub_migrator owner
   using an infrastructure account and unique credentials. Run docker/postgres/init-roles.sh
   with POSTGRES_USER, POSTGRES_DB and HUB_APP_DB_PASSWORD supplied through protected input;
   it grants the selected database's runtime role only CONNECT/USAGE. Migrations grant table
   privileges explicitly. Runtime DATABASE_URL uses hub_app, never a superuser/migrator.
   DATABASE_MIGRATOR_URL is operations-only and points to the same endpoint/database. Do not
   copy development passwords or change a shared database name to bypass safety guards.
6. **Backups before data.** Configure WAL archiving and encrypted off-server pgBackRest using
   ops/pgbackrest/pgbackrest.conf.example and the actual database/path/endpoint. Keep the cipher
   and repository IAM credentials only in the backup service's protected environment; app and
   worker receive non-secret backup metadata, not backup access. Retain at least 30 days;
   schedule nightly full backup (khidi-backup.timer, 02:00 Asia/Tbilisi) and continuous WAL.
   Run stanza-create and check, take a full backup, inspect archive/backup age and alert on
   failures/lag. Keep the encryption key separately recoverable. A schedule is not a restore test.
7. **Object storage.** Create separate private and public buckets with separate infrastructure
   and runtime credentials. Provision versioning, private Object Lock COMPLIANCE retention
   (minimum 30 days), encryption, deletion protection and replication to a second location.
   Protect raw/, evidence/, master/ and reports/; public contains disposable approved derivatives.
   Review corepack pnpm media:storage, then use -- --apply only after configuring the actual
   supported provider/replica. Verify denied runtime deletion/retention changes and a replicated
   sample's bytes/SHA-256, not only configuration responses. See media-storage.md. Runtime
   storage access is restricted; it cannot change policies, replication or private versions.
8. **Preflight and migrations.** With the operations environment (both DB URLs), run corepack
   pnpm ops:check-config. It validates all required production settings without connections or
   printing credentials. Abort on any error. Stop all writers; take a recovery point before
   changing an existing database. Run corepack pnpm db:migrate as hub_migrator. Never edit an
   applied migration, manually mark it applied, or run a seed to fill missing business data.
9. **Worker deployment.** Run corepack pnpm media:jobs:deploy with the migrator configuration.
   It deploys pg-boss and media/AI/reservation/report queues and runtime grants. Start services
   only after this succeeds. The runtime worker has hub_app and the same storage/signing/
   encryption/VAPID settings as the app. It must not receive DATABASE_MIGRATOR_URL or backup
   cipher/IAM keys. Both processes run the runtime preflight; the Hub start command uses
   ops/check-production-config.ts --runtime before opening its listener.
10. **Reference catalog, then first ADMIN.** With the explicit target DATABASE_URL, run
    corepack pnpm ops:reference-data for a preview. Review it against docs/catalog/README.md,
    then run corepack pnpm ops:reference-data --apply --expect-database=<actual-database-name>.
    This audited command installs only approved neutral categories/types (33 types); it never
    runs a development seed or creates accounts, entities, stores, pools, products or stock.
    Re-running unchanged data is a no-op. See docs/milestones/m11-h10-reference-setup.md.
    Only if users is completely empty, in an unrecorded interactive terminal,
    run corepack pnpm ops:bootstrap-admin. Enter email, name and password interactively; password
    and confirmation are hidden. No account credentials are accepted from arguments/env.
    The command creates one audited ADMIN with mandatory TOTP enrollment and no session, entities,
    storefronts, devices or settings. Bootstrap refuses an existing account, even inactive.
11. **Start and configure.** Run the Hub's production start script bound to loopback (set the
    service's bind address/Next hostname explicitly) and corepack pnpm --filter @khidi/worker start, restarting on
    failure under the service manager. Check /api/health through the app host/gateway: it must
    return 200 and connected without credentials. The worker emits its neutral queue/health
    summary; supervise process health and monitor oldest pending/dead-letter jobs, failed
    webhooks, backup/WAL age and daily report completion. Never dispatch restored deliveries
    during a recovery drill. Set journal size/retention or daily log rotation (e.g. 14 compressed
    days, root-readable), monitor disk, and avoid debug SQL/request logging.
12. **People and pilot.** The first ADMIN completes TOTP. Create real legal entities and VAT
    settings on the entities page, then storefronts on the stores page. In inventory's ADMIN
    controls create owner pools, record commercial relationships and select storefront pools.
    Existing consignment/drain safeguards apply. Set mappings and users through their UI.
    Products → subtype management permits audited key/KA/EN additions only for ACCESSORY,
    POWER_TOOL and FARM_PROCESSOR, without guessing required specs. Do not use development
    seeds or improvised SQL for any customer's business configuration.
    Create the second ADMIN through the H9
    users screen, privately hand over its one-time link, and independently verify its TOTP
    login before pilot. See user-management.md and user-recovery.md. Complete the restore and
    real-device/thermal-printer gates in pre-pilot-checklist.md before real intake.

## Upgrade

1. Build and test a tagged release in isolated CI. Review its new migrations, environment
   requirements and release notes. Run production deployment preflight before stopping the
   current release. Preserve environment-specific configuration; never overwrite a filled env.
2. Stop Hub, workers and other writers. Capture current counts/checksums, take a fresh full
   database backup/WAL recovery point and verify object replica/version availability. Record
   the release SHA and backup set; do not proceed if recovery prerequisites are unavailable.
3. Apply new migrations and media:jobs:deploy using operations credentials. Review the reference
   catalog preview and apply its approved changes with the exact target name if needed; inspect
   any resulting identity re-verification. No SKU is automatically reclassified. Do not run tests,
   seeds or bootstrap on the existing shared database.
4. Switch release directories, restart app and worker with runtime credentials, then smoke:
   app health/database, office login/TOTP, authorized admin read, API-key-scoped product/stock
   read on the API host, host isolation, job heartbeat and PWA/service-worker update. Do not
   place a fake real order or change real stock as a smoke test. Verify backlog/failed jobs.
5. If smoke fails, stop writers and use the recovery policy. Preserve sanitized diagnostic
   records and the failed release; do not improvise data changes to make the new binary run.

## Recovery and rollback policy

Migrations are forward-only. A data/schema rollback means restoring PostgreSQL to the recorded
backup/WAL point plus compatible immutable object versions/replicas, using backup-restore.md.
Do not run down migrations or erase migration history. An older binary is not automatically
compatible, especially for session inactivity and credential changes. Invalidate stale sessions
as the relevant auth runbook requires before reopening access. Confirm the restored release,
counts/migrations, inventory rebuild and object hashes, then perform isolated H6 checks before
reopening traffic. The local command corepack pnpm ops:restore-drill demonstrates tooling only;
the owner must separately perform and record the real-server recovery exercise.

## Incident follow-up

Seeds reject production and require explicit _dev/_test names; tests require NODE_ENV=test and
both dedicated _test names before database mutation. No override exists. These guards do not
remove development accounts written by an earlier incident. Inventory and deactivate those
accounts through audited user management; never delete real users/data or clear users to
rerun bootstrap. This milestone does not change a production env, database, gateway or service.

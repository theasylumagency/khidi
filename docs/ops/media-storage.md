# Media storage operations

M4 keeps originals, evidence and master versions private and retained. Public storage
contains generated copies only. The application account can read private versions and
create new private keys; it cannot delete private objects, change bucket policy, retention,
replication or ACLs. Use separate infrastructure credentials for the commands below.

## Local development

The default filesystem adapter needs no object-storage server. Its root is resolved from
the workspace, so the Hub and worker use the same files. To exercise S3 instead:

```sh
docker compose --profile media up -d --build --wait minio
corepack pnpm media:dev:init
corepack pnpm media:jobs:deploy
```

Then set `MEDIA_STORAGE_DRIVER=s3` in the **local development** environment and start the
Hub and worker. `.env.example` supplies local-only account defaults. The initializer
creates separate private/public buckets, enables versioning, enables 30-day COMPLIANCE
retention for private versions, and provisions the restricted `khidi-runtime` account.
It refuses production mode, remote endpoints and unexpected containers/images.

The development image is built from upstream source because the upstream binary images
are no longer available. It pins MinIO security release `RELEASE.2025-10-15T17-29-55Z`
at commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a` and the official `mc` CLI
`RELEASE.2025-08-13T08-35-41Z` at `7394ce0dd2a80935aded936b09fa12cbb3cb8096`.
Both tools stay inside the development container; no application dependency is added.
Upstream MinIO is archived; this image is for local development, not a production
storage recommendation. See the [upstream security release](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z).

MinIO's root account bypasses bucket-policy checks. Never run the application as root.
Integration tests use the restricted account and verify that both version deletion and
delete-marker creation are refused. The development provider does not enforce the AWS
conditional-header policy; the storage adapter still uses atomic `If-None-Match: *`.
Production configuration requires provider-side conditional writes as well.

To run the real S3 test, initialize **dedicated** buckets named `khidi-test-private` and
`khidi-test-public` through the same initializer, setting `MEDIA_PRIVATE_BUCKET` and
`MEDIA_PUBLIC_BUCKET` in its process environment. Run `pnpm test` with a dedicated
PostgreSQL `_test` database and `MEDIA_TEST_S3_ENDPOINT=http://127.0.0.1:9000`.
The test refuses non-loopback endpoints and bucket names outside `khidi-test-…`.
Optional test account overrides use `MEDIA_TEST_S3_ACCESS_KEY_ID`,
`MEDIA_TEST_S3_SECRET_ACCESS_KEY`, `MEDIA_TEST_ADMIN_ACCESS_KEY_ID` and
`MEDIA_TEST_ADMIN_SECRET_ACCESS_KEY`. Without an endpoint the S3 integration test skips.

## Production protection plan

Provision the two buckets and a replica destination in a separate location first. Enable
Object Lock support on the private source and replica. Keep a minimum 30-day recovery
history; do not configure lifecycle deletion of canonical originals or evidence. Encrypt
both locations at rest and use TLS. Provision the replication role and destination
permissions through infrastructure; the Hub account must not have infrastructure rights.

Supply infrastructure credentials through the operator's secret manager, plus:

- `NODE_ENV=production`, `MEDIA_PRIVATE_BUCKET`, `MEDIA_PUBLIC_BUCKET`, region and HTTPS
  endpoint if using an S3-compatible service.
- `MEDIA_RUNTIME_PRINCIPAL`: the runtime IAM principal ARN, or `*` to deny the protected
  operations to all principals through this bucket policy.
- `MEDIA_RETENTION_DAYS=30` or more.
- `MEDIA_REPLICA_LOCATION`: the independently provisioned replica region/site; it must
  differ from the source location.
- `MEDIA_REPLICATION_CONFIG_JSON`: S3 replication configuration with an enabled rule,
  replication role and a different destination bucket. Prefer prefix `""` to cover raw,
  evidence and all master versions, with delete-marker replication disabled.

`corepack pnpm media:storage` prints a reviewable plan and a minimal runtime IAM policy.
It does not change storage. Preserve unrelated statements in the existing bucket policy.
After reviewing the plan, the operator runs `corepack pnpm media:storage --apply`.
Production refuses weakened conditional-write/encryption settings and refuses `--create`;
regional bucket creation belongs to infrastructure. The script enables versioning,
encryption, COMPLIANCE retention, deletion protection and replication, and reads back
versioning, retention and replication configuration. A failed provider capability is an
error, not a fallback to weaker production protection.

Attach the emitted runtime IAM policy to the dedicated application account/role. Do not
attach broad administrator policies alongside it. The policy grants private read/version
read and new object writes, and public copy put/get/delete only. It grants no private
delete, ACL change, retention change, bucket-policy or replication rights.

For S3-compatible providers, provision their remote replication target first; their
destination registration and encryption/KMS setup may be provider-specific. Verify an
actual sample's replication status and SHA-256 at the second location. A successful
configuration response alone does not prove replication delivery. Relevant primary
references: [S3 conditional-write enforcement](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html)
and [encrypted-object replication](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-config-for-kms-objects.html).

## Worker and private views

After application migrations, run `corepack pnpm media:jobs:deploy` with `hub_migrator`.
Then start the worker with `DATABASE_URL` for `hub_app`. Runtime pg-boss migration and
automatic index rebuilding are disabled; queue execution/supervision uses explicit grants.
Monitor `/media/jobs` for terminal failures and retry after fixing the cause.

Set a new random `MEDIA_SIGNING_SECRET` of at least 32 characters on the Hub. Production
startup rejects a missing/default secret, filesystem storage and development S3 credentials.
Private links expire after five minutes and also require the issuing ADMIN session.
Refreshing the media panel issues fresh links. Public URL generation uses the individual
storefront's `media_base_url`; no CDN or storefront integration is deployed in M4.

## Restore proof

`ops/verify-restore.ts` now samples up to 25 raw records from the same read-only database
snapshot used for core row counts. It verifies source bytes before backup and restored
bytes after recovery. Supply separate `RESTORE_MEDIA_…` settings for the restored storage,
including `RESTORE_MEDIA_STORAGE_DRIVER` and either an absolute filesystem root or the
S3 endpoint/bucket/credentials. Source and target storage must differ. Replica object
version IDs may differ; immutable keys, SHA-256, byte counts and restored DB metadata
must match.

For a separately retained manifest, set `MEDIA_RAW_MANIFEST` to a new private JSON file,
`SOURCE_WRITERS_STOPPED=yes` and `SOURCE_MIGRATOR_URL`, then run
`corepack pnpm media:restore --capture`. To verify it, supply `RESTORE_MIGRATOR_URL` and
the separate `RESTORE_MEDIA_…` configuration and run `corepack pnpm media:restore`.
The manifest contains metadata and hashes, never image bytes or storage credentials.

See [the combined PostgreSQL/media runbook](backup-restore.md) for writer shutdown,
PITR, checksum/count checks and the separate `_test` copy used by automated tests.
Only the human owner can certify the shared-server replication and first restore before
M4 deployment; local integration tests do not satisfy that deployment gate.

## M11 recovery extension

The verifier now checks every private raw/master/derivative/evidence/report reference, including
reads through recorded version IDs after recovery. If a replica renumbers versions, only a missing
version falls back to the immutable key and still requires the original SHA-256; authorization
errors or mismatched bytes fail. The local PostgreSQL plus MinIO drill is one command,
corepack pnpm ops:restore-drill, on a developer/isolated CI machine. See backup-restore.md.

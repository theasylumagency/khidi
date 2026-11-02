# ADR-006 — Immutable private originals and S3-compatible media storage

Status: Accepted (M4 technical choice authorized by AGENTS.md P1)
Date: 2026-11-02

Use one `MediaStorage` interface with S3-compatible and filesystem adapters. MinIO
is the development S3 endpoint; production uses protected S3-compatible buckets.
Filesystem storage is for tests and Docker-less development and is rejected in
production. It stores literal original bytes, with atomic `wx` creation.

Private `raw/{image-id}/…`, `master/{image-id}/v{n}/…` and `evidence/{evidence-id}/…`
objects are write-once. IDs are UUIDv7 image/evidence IDs, never SKU IDs or KH codes.
Each successful write returns SHA-256, byte count and an S3 version ID when available;
database metadata persists them. Every private read requires and verifies the expected
SHA-256; S3 reads can pin the recorded version. Failed/incomplete writes are never
silently overwritten. Storage failure leaves the client's queued original intact.

S3 uses `If-None-Match: *` for private writes. This is supported by the
[S3 conditional-write contract](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).
Two distinct buckets separate private originals/masters/evidence from public derivatives.
The application adapter has no private deletion operation. Published copies can be
replaced or withdrawn. Only P9's eligibility checks can select public image content;
no storefront delivery/CDN is introduced in M4.

Before shared-server M4 deployment, operations must enable versioning on both buckets,
encrypted replication to a second location and deletion protection on raw/evidence.
Use Object Lock with at least 30-day retention plus a runtime policy denying raw/evidence
DeleteObject/DeleteObjectVersion and overwrite without a conditional write. The runtime
must not have bypass-retention, bucket-policy or lifecycle administration privileges.
Where an S3-compatible service lacks these controls, deployment is blocked until the
operator provides equivalent, verified protection. Replication/versioning alone is not
a backup and must not propagate deletions to the protected recovery location.

P10 supplies configuration/verification scripts and a manifest of sampled raw keys,
recorded version IDs, byte counts and hashes. Restore database and object storage
into isolated locations, then compare every sampled SHA-256 through this interface.
The runbook in `docs/ops/backup-restore.md` covers the combined recovery order. A human
must activate and test the shared-server backup before deployment; local tests do not
claim production replication or physical-device verification.

Dependency setup is pinned to registry releases at least two weeks old on this date:
`@aws-sdk/client-s3` 3.1152.0 (2026-10-14), `sharp` 0.35.5 (2026-09-27), and
`pg-boss` 12.38.0 (2026-10-13). No signed S3 URL dependency is needed: private downloads
will use short-lived authenticated Hub URL signatures and the storage adapter.
### Deterministic processing and durable execution (P6)

The deployment command `corepack pnpm media:jobs:deploy` installs the pinned pg-boss
schema `khidi_jobs` as `hub_migrator`, creates the three media queues and their dead-letter
queue, and explicitly grants runtime DML, schema USAGE and function EXECUTE to `hub_app`.
It does not grant schema CREATE. Run it after application migrations and before starting
`corepack pnpm dev:worker` (or the production worker process). Runtime schema migration is
disabled. Re-run the deploy command after an explicitly reviewed pg-boss upgrade.
Automatic index rebuilding is disabled in the runtime; an operator uses pg-boss's
`getReindexCommands()` and the migrator role during a maintenance window if needed.

The outbox dispatcher inserts pg-boss jobs in the same PostgreSQL transaction that marks
their delivery complete. Processing retains its state in `media_jobs`, including three
attempts with exponential backoff and terminal failures. An audited ADMIN retry increments
a generation, so old executions and delayed dead-letter notifications cannot cancel it.
An expired worker lease is recovered by pg-boss supervision. Permanent media records and
master versions do not depend on pg-boss's operational job retention.

The master is a square JPEG in sRGB, at most 4096 px, with 5% padding on each side on
`#f5f5f4`. Sharp auto-orients the source and strips all metadata. The private derivatives
are 400/800/1600 square WebP (quality 85) and AVIF (quality 65). The 64-bit difference hash
flags nearby candidates within the same SKU (default Hamming distance 6); it never rejects,
verifies, identifies or replaces a photo. Class A photos wait for a SKU resolution before
comparison. The filesystem adapter resolves its development root from the repository,
so the Hub and worker share originals even when their working directories differ.

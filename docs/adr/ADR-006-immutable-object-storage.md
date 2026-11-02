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

# ADR-004: pgBackRest for PostgreSQL backups and restore verification

- **Status:** Accepted (implementation tooling; shared deployment verification pending)
- **Date:** 2026-11-02
- **References:** Corrections C6; Specification §16.7; AGENTS.md §10 S7

## Decision

Use pgBackRest 2.60.0 with PostgreSQL 18. The local drill image pins the Debian
package `2.60.0-1.pgdg13+1`. Use continuous WAL archiving, nightly full backups,
time-based retention of at least 30 days, and an AES-256-CBC encrypted S3 repository
outside the application server. Supply encryption material from a secret manager;
use the backup host's IAM role for object-storage credentials.

pgBackRest combines physical backup, WAL archive verification, recovery targets,
retention and repository encryption in one tool. This fits the required operational
workflow without assembling those policies across scripts around WAL-G.
See the [official guide](https://pgbackrest.org/user-guide.html),
[restore reference](https://pgbackrest.org/command.html#command-restore) and
[retention reference](https://pgbackrest.org/configuration.html#section-repository/option-repo-retention-full-type).

## Verification and limits

`ops/verify-restore.ts` requires a maintenance window with all source writers stopped.
It captures source counts, takes a new full backup, restores a named set into a
validated empty directory, starts an isolated cluster, checks migration checksums
without applying migrations, compares 16 core tables, and only then runs the test
suite against the restored copy. It writes a report and stops that copy.
Default tablespaces are supported; custom tablespaces require an explicit isolated
mapping before extending this tooling. The scripts do not delete an existing PGDATA.

Nightly online backups do not require stopping writes. The maintenance window is
needed only for exact source/restore row-count comparison. Local POSIX repository
tests demonstrate the workflow but do not validate the future off-server S3 setup.
The human owner must perform and record the first shared-server restore before any
pilot intake. Media bucket versioning and replication remain M4.

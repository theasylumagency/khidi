# Safe database tests

Never run seeds or tests on a shared server (including staging). Use an isolated developer
or CI machine. See [server setup](ops/server-setup.md) for the production bootstrap sequence.
Both seed entry points additionally reject production and require explicit `_dev`/`_test`
names in both database URLs. `pnpm test:safety` checks these guards without PostgreSQL.

`pnpm test` sets `NODE_ENV=test` through a Node preload on Windows and POSIX shells.
Before loading any database code, Vitest's global setup requires both `DATABASE_URL`
and `DATABASE_MIGRATOR_URL` to be valid PostgreSQL URLs with explicit database names
ending in `_test`. There is no override. Missing, malformed or non-test URLs abort
with `SAFETY:` before migrations, foundation seed or product seed can run.
Connection overrides in query parameters are rejected. Names must fit PostgreSQL's
[63-byte identifier limit](https://www.postgresql.org/docs/18/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS)
so truncation cannot remove the required suffix.

Create a separate, disposable PostgreSQL database such as `agrotrade_hub_test`, with
the existing `hub_migrator` and `hub_app` role separation. Export both connection URLs
in the test command's environment; do not change a production `.env` or use a
production database. The development fallback `agrotrade_hub` is also rejected.
The application and migrator URLs should target that same dedicated test database.

Run `pnpm typecheck`, `pnpm lint`, `pnpm test` twice (fresh database, then re-run),
and `pnpm build`. The first test run applies migrations and both seeds to the test
database; repeat runs retain the existing migration checksums and seed behavior.
Direct Vitest invocations also pass through the global setup guard.

The validator in `packages/db/src/test-database-safety.ts` is pure and can be tested
without PostgreSQL using `pnpm test:safety`. That command selects only these pure
tests with `vitest.safety.config.ts`, without integration global setup. The tests
mock migrations and seeds to verify that invalid
configuration cannot invoke any of them and that valid setup preserves their order.
Database URLs and credentials are never included in safety error messages.

Restored databases whose names do not end in `_test` are rejected too. Prepare a
separate `_test` database for suite execution; a restored production name does not
qualify merely because the server or port is isolated.

M4's restore verifier checks the recovered database without changing it, then creates
a new clone on that isolated server using `RESTORE_TEST_MIGRATOR_URL` and
`RESTORE_TEST_APP_URL`. Both must identify the same new `_test` database, with the
separate database roles. `RESTORE_ADMIN_URL` may supply an isolated server account
with CREATEDB when the migrator lacks that infrastructure privilege. Existing test
copies are refused and never dropped. The same hard global-setup guard applies to
the suite run against this clone.

Media tests normally use temporary filesystem adapters. To include the S3 integration
test, prepare the local MinIO test buckets and restricted runtime account as described
in [media operations](ops/media-storage.md), then export `MEDIA_TEST_S3_ENDPOINT`.
The full M4 acceptance run includes this test; it refuses a remote endpoint or
non-test bucket names. No production object-storage credentials are needed.

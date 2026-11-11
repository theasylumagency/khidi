# Dependency security — M11

Reviewed 2026-11-08 against the production lockfile and upstream advisories. No advisory
is suppressed through audit configuration. Versions remain exact; no Zod 4 migration.

| Dependency | Finding | Action |
| --- | --- | --- |
| drizzle-orm 0.40.0 | High: improperly escaped SQL identifiers | Upgrade every workspace consumer to 0.45.4, published 2026-10-08, older than two weeks. Add an identifier-escaping regression and verify domain/database transactions. |
| uuid 8.3.2 through ExcelJS 4.4.0 | Moderate: bounds on supplied v3/v5/v6 output buffers | ExcelJS calls only v4(), with no arguments, in conditional formatting. Override this exact parent dependency to CommonJS-compatible uuid 11.1.1 (published 2026-04-29); exercise XLSX write/read and conditional-format generation. |
| zod 3.24.2 | High: oversized collection validation can accumulate excessive issues | No patched 3.x release exists in the advisory's range. Keep Zod 3 under the owner instruction; bound actual request bytes before parsing, preflight JSON shape before Zod, and cap schema strings, arrays and records. Zod 4 migration is Proposed ADR-015. |

Primary references:
[Drizzle advisory](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9),
[UUID advisory](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq),
[Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Release timestamps were verified against npm registry metadata.

## Zod mitigation and residual finding

Authentication requests retain small per-route limits (4–64 KiB). Storefront commands
are at most 64 KiB. Other JSON defaults to 1 MiB; CSV import has an 8 MiB transport cap
and retains its existing 2,000,000-character CSV limit. Multipart photos/evidence retain
the existing 15 MiB file limit plus 64 KiB envelope allowance. Bound actual streamed
bytes even when Content-Length is missing or false, refuse compressed request bodies,
and reject malformed UTF-8/JSON before domain operations.

Before Zod, reject nesting beyond 20 levels, more than 20,000 JSON nodes, arrays or
objects beyond 1,000 entries, and oversized strings/keys. Strings/arrays have explicit
schema maxima. boundedRecord performs an entry-count check before validating any
record value, because Zod 3 records have no .max() method. Existing narrower limits stay
in effect. Reverse-proxy limits provide an additional outer boundary; see server setup.

This mitigates the externally reachable allocation path; it does not claim the library
is patched or remove its high-severity audit entry. Keep the finding visible until the
separate migration to a patched Zod 4 release is approved and verified. Monitor new
advisories and run production audit on each dependency update.

Verification results are recorded in the M11 milestone record at final acceptance.

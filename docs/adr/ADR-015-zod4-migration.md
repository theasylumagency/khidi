# ADR-015 — Migrate schema validation to patched Zod 4

Status: Proposed
Date: 2026-11-08
Scope: dependency migration; no business validation policy changes

Zod versions below 4.6.6 are reported by GHSA-mrhx-c7xc-m3w5. The last published stable
3.x line is still affected according to the advisory. The M11 owner explicitly defers a
major-version migration and requires bounded inputs instead.

Propose migrating all workspace consumers together to an exact patched Zod 4 version
at least two weeks old, preserving strict API contracts, defaults and Georgian messages.
Review record-key semantics, defaults/optional fields, custom issues, transformations,
error formatting and JSON-schema/OpenAPI generation. Never weaken evidence, accounting,
identity, lifecycle or authorization rules to accommodate the dependency.

Required before acceptance: compare valid/invalid request behavior, keep body and shape
preflight limits, run schema/HTTP/security regressions and the complete suite, typecheck,
lint, boundaries, build and production audit. Record any intentional API change separately.

Until approved, M11 keeps Zod 3 with the documented mitigations in
[dependency-audit.md](../security/dependency-audit.md). This ADR does not authorize the migration.

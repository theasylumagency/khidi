# ADR-001: Single Global User Role with Legal Entity Memberships in Phase 1

- **Status:** Accepted
- **Date:** 2026-11-01
- **Refs:** Technical Specification v1.2 §13.1, Corrections v1.1 `[C12]`

## Context

AgroTrade Hub serves two legal entities (`AGROTRADE` and `NEWBRAND`) that share a physical warehouse and staff. Under §13.1, the system defines five roles:
- `ADMIN`
- `OPERATOR`
- `STOCK_MANAGER`
- `WAREHOUSE`
- `ORDER_MANAGER`

In addition, users belong to one or both legal entities (`user_entity_memberships`), which restricts which stock pools, replenishment requests, and movement reports they can view and act upon, and may hold granular permission overrides (`user_permissions`, e.g., `price.edit`, `stock.transfer.cross_entity`).

## Decision

For Phase 1, each user has a single global `users.role` column combined with `user_entity_memberships (user_id, legal_entity_id)` and `user_permissions (user_id, permission_key)`.

## Limitation

A single user account cannot hold one base role (e.g., `STOCK_MANAGER`) in `AGROTRADE` and a different base role (e.g., `OPERATOR`) in `NEWBRAND` simultaneously. When a user is a member of both entities, their global `users.role` applies across both entities.

## Future Migration Path (Phase 2+)

If future operational staffing requires per-entity roles for the same user account:
1. Add `role TEXT` (nullable at first) to `user_entity_memberships`.
2. Backfill `user_entity_memberships.role = users.role` for all existing memberships.
3. For entity-scoped operations (inventory, reports, replenishment, storefront order management), evaluate the role from `user_entity_memberships.role` for the active entity context, keeping global `ADMIN` and catalog-wide `OPERATOR`/`WAREHOUSE` roles either on `users.role` or on a system-scope membership.

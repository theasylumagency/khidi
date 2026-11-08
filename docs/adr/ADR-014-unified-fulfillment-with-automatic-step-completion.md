# ADR-014: Unified fulfillment with automatic step completion

- **Status:** Accepted
- **Date:** 2026-11-10
- **Decided by:** project owner
- **Relates to:** ADR-013 (declared availability), Corrections C1, C4, C14, C16, C18;
  M9 task decisions 2, 3, 8, 11

## Context

ADR-013 removed the Hub's dependence on the client's physical warehouse for stock. Fulfillment
has the same problem: picking, staging and handover confirmations depend on warehouse staff
scanning and confirming, which the client's current processes will not support reliably. The Hub
must not depend on that disorder, while keeping its own ledger exact.

## Decision

Implement one canonical fulfillment workflow with two operating modes.

### CONTROLLED_FULFILLMENT

The full reservation, picking, staging, handover and cancellation workflow as specified in M9.
Required physical steps are confirmed by authorized staff (`SCAN` or `MANUAL`).

### SIMPLIFIED_FULFILLMENT (default)

The same fulfillment states, ledger movement types and inventory invariants. When the applicable
storefront confirmation occurs, all remaining fulfillment steps are automatically treated as
completed:

- `CARD`: after confirmed payment success.
- `BANK_INSTALLMENT`: after bank approval and confirmed order acceptance.
- `CASH_ON_DELIVERY` / `PAY_ON_PICKUP`: after confirmed order acceptance. This is never
  represented as payment collection.

The Hub performs the normal ledger movements in the correct order in one atomic transaction —
`COMMIT` (if not yet committed), `PICK_TO_STAGING`, `HANDOVER_OUT` for card/installment; `COMMIT`
and `HANDOVER_OUT` together after the pick for COD/pickup (C4 ordering) — and closes the
fulfillment request as `HANDED_OVER`. No warehouse tasks, scans or physical handover
confirmations are created or awaited.

### Scope and configuration

- The fulfillment mode is a **Hub setting**, not a storefront property. It describes how the
  physical (offline) side is handled, so it belongs to the bridge and never to a structure on the
  online side. Storefronts cannot see or change it and their API behaves the same in both modes;
  only the provenance in webhooks differs.
- One Hub-wide setting (system setting `fulfillment_mode`), default `SIMPLIFIED_FULFILLMENT`.
  Only a Hub ADMIN changes it; the change is audited.
- If the business later has several physical locations with different processes, the setting
  moves to the offline side of the model (the stock pool), never to the storefront. Not built now.
- The mode is **frozen on the reservation** when it is created. A later change affects only new
  reservations.

### Confirmation provenance

Each fulfillment step records how it was confirmed:

- `SCAN` — confirmed by scanning;
- `MANUAL` — confirmed by an authorized user with a reason;
- `AUTO_ASSUMED` — accepted automatically under simplified mode.

`AUTO_ASSUMED` is a trusted system workflow confirmation, not a simulated scan or a fabricated
staff action. It satisfies the engine's unit-confirmation proof hook only for reservations frozen
in simplified mode.

### Principals

Automatic completion runs as a dedicated principal `SYSTEM_WORKFLOW` (policy: simplified
fulfillment), added to M9 decision 11 with the allowlist `COMMIT`, `PICK_TO_STAGING`,
`HANDOVER_OUT`. Audit and fulfillment history record both the **trigger** (the storefront API key
and its confirmation call) and the **executor** (`SYSTEM_WORKFLOW`). The storefront service
principal itself never gains picking or handover rights.

### What the storefront and reports see

- Webhooks report the final status `HANDED_OVER` with `confirmation: AUTO_ASSUMED`, so a
  storefront never mistakes it for a physically confirmed shipment.
- Movement reports (M10) show the provenance per line.

## Consequences and accepted trade-offs

- **Cancellations after confirmation are outside the Hub.** In simplified mode an order is closed
  at confirmation. If a COD or pickup customer cancels afterwards, the Hub does not restore stock
  (C1); the admin declares the new availability (ADR-013). Reports will show the sale; the
  storefront's order and refund records are the accounting source for cancellations. This is the
  same model as returns and is accepted.
- **Overselling risk stays business-side** (ADR-013): the Hub sells against the declared number.
- **Failed or expired reservations** are released without automatic fulfillment (decision 12 of
  M9 still decides expiry versus commit races).
- **Controlled fulfillment remains implemented in the domain** (picking, return to shelf,
  partial cancellation C16, lost in staging C14) and covered by tests, but **disabled by
  default**. Its warehouse picking UI and the manual-confirmation UI are deferred until the
  Hub is switched to controlled mode; the domain and its tests are not deferred.

## Safety requirements

- Preserve the 15 movement types and the C2/C3 invariants.
- Never deduct available stock twice.
- Never alter another storefront's allocation.
- Process automatic completion atomically and idempotently (a replayed confirmation is a no-op
  returning the original result).
- Use the correct CARD/BANK versus COD/PICKUP movement ordering.
- Automatically completed orders remain closed; post-closure returns and delivery issues are
  outside the Hub.

## Acceptance tests

- Both modes produce identical final ledger balances for equivalent completed orders.
- Automatic progression for CARD, BANK_INSTALLMENT, COD and PICKUP, including bundles.
- Payment failure and expiry release without fulfillment.
- Replayed confirmation does not move stock twice; concurrent confirmation and expiry — exactly
  one wins.
- Mode switch affects only new reservations; an existing reservation completes in its frozen
  mode; storefront API keys cannot read or change the mode.
- `AUTO_ASSUMED` is rejected as a proof for a reservation frozen in controlled mode.
- Storefront principal cannot pick or hand over; `SYSTEM_WORKFLOW` cannot reserve or release.
- Webhook payload carries `AUTO_ASSUMED`.

Keep the PR in draft and stop for review. Do not merge or deploy.

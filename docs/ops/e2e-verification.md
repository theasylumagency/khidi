# M11 service and HTTP verification

Use a dedicated local/CI `_test` database with both explicit database URLs and NODE_ENV=test.
`corepack pnpm ops:e2e` deliberately does not load `.env`, run seeds or apply migrations.
Provision the empty synthetic source separately, or use the writable clone produced by
ops:restore-drill. The recovered original is never the scenario target.

The command creates fresh, explicitly synthetic users/entities/types/intakes on each run.
It uses the real service transactions, image processing, HTTP storefront handler, existing
TestStorefrontClient and a real loopback signed webhook receiver. No browser automation,
live AI, push delivery, accounting connection or arbitrary restored outbox dispatch is used.
Only new scenario-specific webhook and notification events are consumed. The previous Hub
fulfillment mode is restored at the end. Never run this command on a shared server.

- A: no-barcode intake, attributed checked plate absence, observable inspection without supplier documents, verified reference
  photos, HOUSE_DEFINED/MEDIUM and explicit ADMIN READY confirmation, approved KA, both
  listings/prices and declared availability produce sellable projections. Repeated runs use
  the existing explicit house-slug suffix consent; they never modify an earlier product.
- B: own and consignment allocations, a low-stock notification, a replenishment request
  closed by an explicit declaration, and an unchanged other-storefront allocation.
- C: CARD reserve/payment/automatic completion, idempotent HTTP replays, exact signed
  AUTO_ASSUMED webhook, immutable report snapshots, COD/pickup in one call, a concurrent
  last-unit race with one winner, and expiry at a real one-second PostgreSQL deadline.
- D: separate consignment seller/owner reports survive changed current mappings/prices;
  changing the relationship is refused while bound, then works after draining and moving
  the storefront; a documented purchase transfer appears on both report sides.

The ordinary focused Vitest entry is apps/hub/src/lib/m11-e2e.test.ts, with temporary
filesystem media. The restore drill uses real MinIO storage and runs the same scenarios
on restored data without the Vitest global setup. Existing controlled-fulfillment tests
remain required. This proves the automated paths, not phone/PWA/printer deployment behavior.

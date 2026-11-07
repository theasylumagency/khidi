# M7 — Base pricing

## Gap inventory (before implementation)

| Requirement | Existing base | M7 extension |
| --- | --- | --- |
| Base prices and immutable history | Pricing constants; seller VAT preference | New append-only price/withdrawal migration, current lookup, history, audited transactional services. |
| Safe changes | Domain transactions, outbox, idempotency, granular permissions | Server-side price permissions, locked current-price comparisons, 30% confirmation/reason, atomic batches and one event per row. |
| Publishing | Separate publication and sale readiness | Load real current prices and project amount/currency/VAT; retain the M8 allocation-owner blocker. |
| Desktop workspace | Authenticated Georgian admin shell and product pages | Storefront price table, inline edits, filters, copy, atomic preview/commit, product history. |
| CSV | No price import/export | BOM export, strict parsing, row errors/exclusions, unchanged and large-change preview, explicit atomic import confirmation. |

## Scope and agreed decisions

One immediate GEL base price per SKU/storefront; integer positive tetri. No scheduled
prices, VAT calculation or storefront promotion logic. Withdrawals append a reasoned
tombstone. Seller VAT is the row default; only admins override it. ADMIN and granted
`price.edit` users edit; WAREHOUSE cannot read or write prices. First prices are not large
changes; changes of 30% or more require explicit confirmation and a batch reason.

Branch `m7-pricing` starts at `main` commit `12feeb9` (PR #12 merged; validator PR #13
not merged when work began). No shared database access or deployment.

## Implementation and verification

P1 adds `0030_storefront_prices.sql`, immediate SET/WITHDRAWN rows and current/history
lookups. Pair-level transaction locks serialize changes, and preview row IDs detect stale
edits. Batches share one ID, reason and confirmation; unchanged rows are skipped. Each
insert writes its audit and storefront-specific outbox delivery in the same transaction.
`PRICE_LARGE_CHANGE_RATIO` configures the threshold (default `0.3`). Database permissions
are checked again by the service. Direct dependencies use existing pinned library versions.

P1: six focused pricing tests and pricing typecheck passed on `khidi_m7_work_test`.
P2 loads stored current prices for every storefront. The public projection adds only
`basePrice: { amount, currency, vat_included }` when present. A withdrawal removes it and
restores `MISSING_STOREFRONT_BASE_PRICE`. A fully publish-ready priced SKU still has the
M8 allocation-owner blocker. Four focused publishing tests and its typecheck passed.
P3 adds the Georgian `/prices` workspace, storefront/type/lifecycle/missing-price filters,
inline GEL editing, selected-row withdrawals, previews and one atomic commit. Copying
selected base amounts uses the destination seller VAT default and the same batch preview.
The product page shows immutable per-storefront history. Staff names are formatted and
storefronts use neutral numbered labels. Navigation honors granular price grants, including
the permanent WAREHOUSE exclusion. API reads/writes are authenticated; commits require
an idempotency key and the current-row IDs from a preview. Money formatting is browser-safe.

P3: focused pricing/API checks and Hub typecheck passed. P4 and final verification remain pending.

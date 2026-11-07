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
tombstone. The first price uses seller VAT; later rows retain the latest row's VAT flag unless
ADMIN changes it. ADMIN and granted
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
selected base amounts uses the same batch preview and retains destination VAT, using seller
VAT only for the first price.
The product page shows immutable per-storefront history. Staff names are formatted and
authorized staff see the stored storefront names. Navigation honors granular price grants, including
the permanent WAREHOUSE exclusion. API reads/writes are authenticated; commits require
an idempotency key and the current-row IDs from a preview. Money formatting is browser-safe.

P3: focused pricing/API checks and Hub typecheck passed.

P4 adds BOM-prefixed UTF-8 export and strict CSV import with comma or semicolon separators,
quoted decimal commas, row errors, explicit exclusions, unchanged rows and large-change
previews. The server reparses the original file on commit, checks expected row IDs under
the same pair locks, and commits one idempotent `CSV_IMPORT` batch. Display names and
export timestamps are ignored on import. Formula-like display names are escaped on export.
Imports target the selected storefront and accept up to 1,000 records / 2 MB per file;
larger imports must be split. Bulk commits accept up to 1,000 selected price rows.

## Owner clarification during M7

- Private price CSVs retain the actual stored `storefront_key`; no alias layer is added.
  `AGENTS.md` now limits concealment to customer/public/outsider-facing material and anything
  storefronts receive. Authorized internal staff screens and exports are outside that scope.
- Development/test seed storefront keys are `store-a` and `store-b`. Seed references and
  assertions were updated. Existing/shared keys are not rewritten. Recreate old fixture
  databases to pick up the new seed keys.
- `0031_storefront_key_immutable.sql` prevents any change to a storefront key after creation;
  it performs no data rename. The new ADMIN creation form explains neutrality and permanence.
  Creation is authenticated, idempotent, audited and emits `STOREFRONT_CREATED` transactionally.
- A narrow `.gitattributes` rule retains LF for `next.config.ts`: the existing CSP source-text
  assertion otherwise fails on a Windows CRLF checkout. The test and production CSP are preserved.

## Initial P1–P4 verification

- 17 focused pricing, CSV/API and storefront-immutability tests passed before final checks.
- Repository typecheck, lint and dependency boundaries passed.
- One full run on fresh `khidi_m7_final_test`: 402 passed, one pre-existing CRLF-sensitive CSP
  assertion failed, and one optional S3 integration test was skipped because MinIO was unavailable.
  After normalizing that checkout and retaining LF through `.gitattributes`, all five architecture
  tests and all five CSV tests passed in a focused retry (10 passed). The full suite was not repeated.
- Desktop browser smoke check: Georgian price table, comma-decimal entry, 30% delta preview,
  disabled confirmation until reason and checkbox are supplied, and storefront key guidance.
- Production build passed, including the Hub's TypeScript and route generation.

## Review corrections

1. VAT defaults to the latest row's flag after the first price, including re-entry after
   withdrawal. Non-admin editors may preserve that flag explicitly or implicitly; only
   ADMIN changes it. Focused pricing tests passed, including an operator retaining `false`.
2. Archived SKUs reject price edits/previews. `0032_archived_sku_price_guard.sql` also
   rejects direct SET inserts for archived SKUs. Merge/split append MANUAL withdrawals
   with a shared batch ID, exact reasons `SKU merged` / `SKU split`, audit and PRICE_CHANGED
   in the correction transaction. Prices are never copied. Shared transaction effects in
   `packages/domain/price-effects` preserve dependency boundaries. SKU row locks precede
   price locks to serialize correction against edits. Confirmation screens list withdrawals
   and warn about unpriced targets with the old amount labeled as information only.
   Fifteen focused correction and regression tests and affected typechecks passed.
3. CSV template export includes every non-archived SKU, optionally filtered by lifecycle.
   Unpriced rows have blank amounts. Blank amounts are explicit no-ops during import,
   including VAT: they never append a row or withdraw a price. The review labels them
   unchanged. A filled template amount creates a first price normally. Eight CSV tests
   and the existing price API checks passed, with affected typechecks green.
4. Every BULK and CSV_IMPORT domain change requires an explicit `expectedPriceId`,
   including `null` for a first price. Copy preview also requires destination expectations
   for every selected SKU; omission and stale IDs are rejected by the domain service.
   CSV_IMPORT also rejects WITHDRAWN operations at the domain boundary. Manual single-price
   behavior is unchanged. All existing split targets are locked in SKU ID order before price
   locks, including targets older than the source.

## Review verification

- 26 focused tests passed across pricing, CSV, catalog-correction prices, API requests and
  the confirmation warnings. The existing split/merge evidence regressions also passed.
- Repository typecheck, lint (including dependency boundaries) and production build passed.
- The full suite ran once on fresh isolated `khidi_m7_corrections_final_test`: **414 passed,
  1 skipped** across 73 files. Only the optional S3 integration case was skipped (no MinIO).
  The existing Windows-sensitive architecture assertion passed with the retained LF rule.
- A final explicit CSV-withdrawal domain guard was then checked by 18 passing pricing/CSV
  tests and the pricing typecheck. No second full-suite run was performed.

## Gaps and business decisions

The M8 allocation-owner blocker remains deliberately unmet. Promotions, VAT calculation,
scheduled prices, public storefront transport and deployment remain outside M7. No business
decision is awaiting approval and no Proposed ADR was needed for the explicitly approved scope.

## Review checklist

- On an isolated database, preview a first price and a 30% change; verify that cancel writes
  nothing and confirmation creates history with the author and a shared batch reason.
- Copy selected prices between storefronts and check destination VAT preservation and the first-price seller default.
- Open a BOM export in Excel, import comma/point decimals, fix or exclude invalid rows,
  confirm an atomic batch, then replay the same request key.
- Verify warehouse denial, per-SKU withdrawal history, and the retained M8 sale blocker.

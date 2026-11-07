# Transaction lock order

All pricing, catalog-correction and inventory services use
`acquireDomainLocks()` from `@khidi/domain/locking`. Locks are held until the outer
transaction commits or rolls back, including when the service runs in an idempotency
transaction. Reads needed to discover the plan do not acquire row locks.

Acquire the complete set at each stage before entering the next stage:

1. Advisory keys, distinct and sorted lexicographically.
2. `skus`, sorted by UUID.
3. `pool_sku_balances`, sorted by `(pool_id, sku_id)`.
4. `allocation_balances`, sorted by `allocation_id`.

An operation may skip stages it does not need. In particular C2 commitment-only batches
(`RESERVE`, `RESERVATION_RELEASE`, `COMMIT`, `COMMIT_RELEASE`) lock only their allocation
rows and never update pool rows. Physical/allocation batches lock every touched pool/SKU
and its allocations, even for allocation-only changes. No read is used as a balance assertion:
balances and the relevant ledger history are read again after their locks are acquired.

The helper creates missing zero balance rows with `INSERT ... ON CONFLICT DO NOTHING`
in the same sorted stage order, then explicitly locks them. A SKU lock protects discovery
of the set of allocation rows: the allocation INSERT trigger takes that same SKU lock.
Allocation identity and pool ownership are immutable, so their metadata cannot move a
balance to another owner while a caller is waiting. Deferred constraint triggers check
pool allocated totals against the final allocation sums at transaction commit.

## Advisory keys

| Logical key | PostgreSQL lock | Usage |
| --- | --- | --- |
| `identity catalog` | Existing two-integer `(412629, 5)` | Catalog identity, identifiers, evidence, shared-accounting checks and corrections. This preserves the key used by the accounting trigger. |
| `price:<lowercase sku UUID>` | `hashtextextended(key, 0)` | Every storefront price for one SKU, including its first price and withdrawal. |

Price locks are per SKU rather than per storefront/SKU pair. A correction therefore knows
the complete key set before locking a SKU, including storefronts with no existing price.
This trades some per-SKU write concurrency for a stable plan; unrelated SKUs remain independent.
Hash collisions may serialize unrelated keys but do not weaken mutual exclusion.

Merge/split first hold the identity lock, then the sorted price keys for all existing source
and target SKUs, then all affected SKU rows in UUID order. Evidence recomputation locks its
complete affected set before writes. Newly created split targets belong to the same transaction.
Identifier collision checks share the identity lock; they do not acquire new identifier
advisory keys after a SKU has been locked.

`withdrawArchivedSkuPrices()` is an internal transaction effect. Its caller already holds
the correction plan's advisory and SKU locks; the effect takes no late advisory locks.
The price INSERT trigger uses the identical price key before its SKU row lock, for SET
and WITHDRAWN rows. It checks the archived condition only for SET. Multi-row direct SQL,
like any service batch, must pre-acquire its complete sorted plan; row triggers alone cannot
sort a statement's incoming rows. Applied migrations remain frozen; migration 0034 replaces
the old trigger path.

Nested services may reuse locks already held by their outer workflow. They must not add
a new advisory key after row locks, or a lower-sorted row after a higher-sorted row. A new
workflow that combines operations must plan their union before calling the inner services.
The count/fulfillment proof adapters used by inventory run in the same transaction and
must follow that outer workflow's complete plan too.

## Verification

Tests hold a source price advisory lock, start a real merge or split on another connection,
observe its advisory wait, then commit a price on the first connection. Both corrections
complete and withdraw that price. The same test covers a direct price INSERT trigger.
Last-unit stock/allocate and reserve races verify the balance serialization separately.
The verification command uses a read-only repeatable-read snapshot and takes no mutation locks.

# M6 — Review, canonical content and publishing

## Gap inventory

| Requirement | Existing base | Extension |
| --- | --- | --- |
| Versioned content and approval by locale | Mutable KA/EN columns on `skus` | Add immutable content versions, approval pointers and an unapproved migration of historical text. |
| Verified factual copy | Product naming helpers and `sku_field_provenance` | Generate and validate content from verified facts. Store the facts the version actually uses and detect later changes in evidence recomputation. |
| Manual and AI proposals | M5 synthetic AI job queue | Add the content editor, deterministic proposals and synthetic AI proposals with explicit human approval. |
| READY and slugs | `transitionSkuToReady` and append-only slug history | Require valid approved KA content and preserve existing READY SKUs and their slugs during migration. |
| Review workspace | Products table, SKU detail, accounting and evidence actions | Show review flags, locale approvals, missing EN and per-storefront publication and sale blockers. |
| Publishing | `evaluateStorefrontSellability` and verified facts/media helpers | Separate locale publication from sale eligibility. Project approved content and verified structured facts. Keep price and allocation blockers explicit. |
| Merge and redirects | Archive lifecycle, identifier resolution, immutable evidence and slug history | Add audited SKU lineage, listing selection and scan/slug redirects while retaining the original records. |
| Split | Inventory ownership and accounting rules are pending | Record the open decisions in a Proposed ADR. |

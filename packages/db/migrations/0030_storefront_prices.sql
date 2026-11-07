CREATE TABLE storefront_prices (
  id UUID PRIMARY KEY,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  storefront_id UUID NOT NULL REFERENCES storefronts(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('SET', 'WITHDRAWN')),
  base_price_minor INTEGER,
  currency TEXT NOT NULL CHECK (currency = 'GEL'),
  vat_included BOOLEAN NOT NULL,
  set_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  set_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() CHECK (set_at <= clock_timestamp()),
  reason TEXT CHECK (reason IS NULL OR length(btrim(reason)) > 0),
  batch_id UUID,
  source TEXT NOT NULL CHECK (source IN ('MANUAL', 'BULK', 'CSV_IMPORT')),
  CHECK ((kind = 'SET' AND base_price_minor > 0 AND base_price_minor IS NOT NULL)
    OR (kind = 'WITHDRAWN' AND base_price_minor IS NULL AND reason IS NOT NULL)),
  CHECK (source = 'MANUAL' OR batch_id IS NOT NULL)
);
CREATE INDEX idx_storefront_prices_current ON storefront_prices (sku_id, storefront_id, set_at DESC, id DESC);
CREATE INDEX idx_storefront_prices_store ON storefront_prices (storefront_id, set_at DESC, id DESC);
CREATE INDEX idx_storefront_prices_batch ON storefront_prices (batch_id) WHERE batch_id IS NOT NULL;
SELECT enforce_append_only_table('storefront_prices');
GRANT SELECT, INSERT ON storefront_prices TO hub_app;

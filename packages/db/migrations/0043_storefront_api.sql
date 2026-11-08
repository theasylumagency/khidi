ALTER TABLE storefront_api_keys ADD COLUMN rate_limit_per_minute INTEGER NOT NULL DEFAULT 120 CHECK(rate_limit_per_minute BETWEEN 1 AND 10000);
CREATE TABLE storefront_api_rate_windows (
  api_key_id UUID PRIMARY KEY REFERENCES storefront_api_keys(id) ON DELETE RESTRICT,
  window_started_at TIMESTAMPTZ NOT NULL, requests INTEGER NOT NULL CHECK(requests>0)
);
GRANT SELECT,INSERT,UPDATE ON storefront_api_rate_windows TO hub_app;
REVOKE DELETE ON storefront_api_rate_windows FROM hub_app;

-- Milestone 1: Foundation Migration (0001_foundation.sql)
-- Runs under hub_migrator role.
-- Infrastructure must provision hub_app role before migrations run; migrations never embed passwords or create roles.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'hub_app') THEN
    RAISE EXCEPTION 'Database role "hub_app" does not exist. Provision roles via infrastructure (init-roles.sh / IaC) before running migrations.';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO hub_app;

-- [C7] Reusable trigger function blocking UPDATE and DELETE on append-only tables
CREATE OR REPLACE FUNCTION prevent_append_only_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; % operation is strictly forbidden [C7].', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$;

-- [C7] Helper to attach append-only trigger AND revoke UPDATE/DELETE/TRUNCATE from hub_app
CREATE OR REPLACE FUNCTION enforce_append_only_table(target_table TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  trig_name TEXT := 'trg_' || target_table || '_immutable';
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trig_name, target_table);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation()',
    trig_name,
    target_table
  );
  EXECUTE format('REVOKE ALL ON TABLE %I FROM hub_app', target_table);
  EXECUTE format('GRANT SELECT, INSERT ON TABLE %I TO hub_app', target_table);
END;
$$;

-- 1. Legal Entities (§4.1, [C11])
CREATE TABLE IF NOT EXISTS legal_entities (
  id UUID PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  legal_name TEXT NOT NULL,
  tax_id TEXT NOT NULL UNIQUE,
  prices_include_vat BOOLEAN NOT NULL, -- [C11] VAT default per legal entity
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users (§13.1, §13.2, [C12] single global role documented in ADR-001)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT,
  totp_secret_encrypted TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  login_locked_until TIMESTAMPTZ,
  pin_hash TEXT,
  failed_pin_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'STOCK_MANAGER', 'WAREHOUSE', 'ORDER_MANAGER')),
  locale TEXT NOT NULL DEFAULT 'ka' CHECK (locale IN ('ka', 'en')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Commercial Entity Relationships (§4.4, [C17])
CREATE TABLE IF NOT EXISTS entity_relationships (
  id UUID PRIMARY KEY,
  from_entity_id UUID NOT NULL REFERENCES legal_entities(id),
  to_entity_id UUID NOT NULL REFERENCES legal_entities(id),
  mode TEXT NOT NULL CHECK (mode IN ('PURCHASE', 'CONSIGNMENT')),
  effective_from TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_entity_id <> to_entity_id)
);

-- 4. Storefronts (§4.2)
CREATE TABLE IF NOT EXISTS storefronts (
  id UUID PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  seller_entity_id UUID NOT NULL REFERENCES legal_entities(id),
  media_base_url TEXT NOT NULL,
  webhook_url TEXT,
  webhook_secret_encrypted TEXT,
  reservation_policy_json JSONB NOT NULL DEFAULT '{"CARD": 1800, "BANK_INSTALLMENT": 259200, "PAY_ON_PICKUP": 259200, "CASH_ON_DELIVERY": 259200}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Storefront API Keys (§12.1, §16.2)
CREATE TABLE IF NOT EXISTS storefront_api_keys (
  id UUID PRIMARY KEY,
  storefront_id UUID NOT NULL REFERENCES storefronts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  allowed_ips TEXT[],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

-- 6. User Entity Memberships (§13)
CREATE TABLE IF NOT EXISTS user_entity_memberships (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  is_stock_manager_recipient BOOLEAN NOT NULL DEFAULT FALSE,
  is_report_recipient BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, legal_entity_id)
);

-- 7. User Granular Permissions (§13.1)
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  granted_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, permission_key)
);

-- 8. Registered Warehouse Devices (§13.2)
CREATE TABLE IF NOT EXISTS registered_devices (
  id UUID PRIMARY KEY,
  device_name TEXT NOT NULL,
  device_token_hash TEXT NOT NULL UNIQUE,
  registered_by UUID NOT NULL REFERENCES users(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Sessions (§13.2, ADR-003)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES registered_devices(id) ON DELETE CASCADE,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('OFFICE_PASSWORD_TOTP', 'WAREHOUSE_PIN')),
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Append-Only Audit Logs (§16.1, [C7])
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id),
  actor_storefront_id UUID REFERENCES storefronts(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  reason TEXT,
  external_document_ref TEXT,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);

-- 11. Immutable Transactional Outbox Events (§12.2, [C10])
CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  storefront_id UUID REFERENCES storefronts(id),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  payload_json JSONB NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Per-Consumer Outbox Deliveries ([C10])
CREATE TABLE IF NOT EXISTS outbox_deliveries (
  id UUID PRIMARY KEY,
  outbox_event_id UUID NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
  consumer TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'DELIVERED', 'DEAD_LETTER')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  UNIQUE (outbox_event_id, consumer)
);
CREATE INDEX IF NOT EXISTS idx_outbox_deliveries_pending ON outbox_deliveries (status, next_attempt_at) WHERE status = 'PENDING';

-- 13. Webhook Delivery Attempt Logs (§12.2, [C10])
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY,
  outbox_event_id UUID NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
  outbox_delivery_id UUID REFERENCES outbox_deliveries(id) ON DELETE CASCADE,
  storefront_id UUID NOT NULL REFERENCES storefronts(id),
  response_status INTEGER,
  response_body_excerpt TEXT,
  duration_ms INTEGER,
  succeeded BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Idempotency Keys (§3.4, §12.1, §16.5) — Atomic IN_PROGRESS / COMPLETED claim
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  response_status INTEGER,
  response_body_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, idempotency_key),
  CHECK (
    (status = 'IN_PROGRESS') OR
    (status = 'COMPLETED' AND response_status IS NOT NULL AND response_body_json IS NOT NULL)
  )
);

-- 15. System Settings (§10.1, §18)
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  description TEXT NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Grant standard CRUD on mutable foundation tables to hub_app
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  legal_entities,
  users,
  entity_relationships,
  storefronts,
  storefront_api_keys,
  user_entity_memberships,
  user_permissions,
  registered_devices,
  sessions,
  outbox_deliveries,
  webhook_deliveries,
  idempotency_keys,
  system_settings
TO hub_app;

-- [C7, C10] Enforce strict append-only (no UPDATE, no DELETE) on audit_logs and outbox_events
SELECT enforce_append_only_table('audit_logs');
SELECT enforce_append_only_table('outbox_events');

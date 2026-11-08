ALTER TABLE accounting_mappings ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX accounting_primary_active ON accounting_mappings(sku_id,legal_entity_id)
  WHERE active AND is_primary;

INSERT INTO system_settings(key,value_json,description)
  VALUES ('fulfillment_mode','{"mode":"SIMPLIFIED_FULFILLMENT"}','Hub fulfillment policy, frozen on new reservations')
  ON CONFLICT DO NOTHING;

CREATE TABLE reservations (
  id UUID PRIMARY KEY, storefront_id UUID NOT NULL REFERENCES storefronts(id) ON DELETE RESTRICT,
  storefront_order_ref TEXT NOT NULL CHECK (storefront_order_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    AND storefront_order_ref !~ '^[0-9]{9,}$'),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CARD','BANK_INSTALLMENT','CASH_ON_DELIVERY','PAY_ON_PICKUP')),
  fulfillment_mode TEXT NOT NULL CHECK (fulfillment_mode IN ('CONTROLLED_FULFILLMENT','SIMPLIFIED_FULFILLMENT')),
  status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','COMMITTED','RELEASED','EXPIRED','HANDED_OVER')),
  expires_at TIMESTAMPTZ NOT NULL, committed_at TIMESTAMPTZ, handed_over_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ, release_reason TEXT,
  created_by_api_key_id UUID NOT NULL REFERENCES storefront_api_keys(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(storefront_id,idempotency_key), UNIQUE(id,storefront_id)
);
CREATE INDEX reservation_expiry ON reservations(expires_at,id) WHERE status = 'RESERVED';

-- The storefront's cart is retained separately from its physical component expansion.
CREATE TABLE reservation_items (
  id UUID PRIMARY KEY, reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0), composed_bundle BOOLEAN NOT NULL,
  base_price_minor BIGINT NOT NULL CHECK (base_price_minor >= 0), currency TEXT NOT NULL,
  final_unit_price_minor BIGINT CHECK (final_unit_price_minor >= 0),
  UNIQUE(reservation_id,sku_id), UNIQUE(id,reservation_id)
);
CREATE TABLE reservation_lines (
  id UUID PRIMARY KEY, reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL, allocation_id UUID NOT NULL REFERENCES allocations(id) ON DELETE RESTRICT,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  parent_bundle_sku_id UUID REFERENCES skus(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  released_quantity INTEGER NOT NULL DEFAULT 0 CHECK (released_quantity BETWEEN 0 AND quantity),
  seller_mapping_id UUID NOT NULL REFERENCES accounting_mappings(id) ON DELETE RESTRICT,
  seller_accounting_item_id TEXT NOT NULL, seller_accounting_name TEXT NOT NULL,
  owner_mapping_id UUID NOT NULL REFERENCES accounting_mappings(id) ON DELETE RESTRICT,
  owner_accounting_item_id TEXT NOT NULL, owner_accounting_name TEXT NOT NULL,
  FOREIGN KEY (item_id,reservation_id) REFERENCES reservation_items(id,reservation_id) ON DELETE RESTRICT,
  UNIQUE(item_id,sku_id), UNIQUE(id,reservation_id), UNIQUE(id,reservation_id,sku_id,allocation_id)
);
CREATE INDEX reservation_lines_header ON reservation_lines(reservation_id,id);

CREATE TABLE fulfillment_requests (
  id UUID PRIMARY KEY, reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  storefront_id UUID NOT NULL REFERENCES storefronts(id) ON DELETE RESTRICT,
  storefront_order_ref TEXT NOT NULL,
  delivery_method TEXT NOT NULL CHECK (delivery_method IN ('PICKUP','COURIER','OTHER')),
  ship_by DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED','PICKING','PICKED','ACTION_REQUIRED','HANDED_OVER','CANCELLED')),
  cancel_reason TEXT, requires_return_to_shelf BOOLEAN NOT NULL DEFAULT FALSE,
  picked_at TIMESTAMPTZ, handed_over_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(reservation_id), UNIQUE(id,reservation_id),
  FOREIGN KEY (reservation_id,storefront_id) REFERENCES reservations(id,storefront_id) ON DELETE RESTRICT
);
CREATE TABLE fulfillment_request_lines (
  id UUID PRIMARY KEY, fulfillment_request_id UUID NOT NULL, reservation_id UUID NOT NULL,
  reservation_line_id UUID NOT NULL UNIQUE,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  parent_bundle_sku_id UUID REFERENCES skus(id) ON DELETE RESTRICT,
  allocation_id UUID NOT NULL REFERENCES allocations(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  picked_quantity INTEGER NOT NULL DEFAULT 0 CHECK (picked_quantity >= 0),
  returned_quantity INTEGER NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  lost_quantity INTEGER NOT NULL DEFAULT 0 CHECK (lost_quantity >= 0),
  handed_over_quantity INTEGER NOT NULL DEFAULT 0 CHECK (handed_over_quantity >= 0),
  CHECK (picked_quantity >= returned_quantity + lost_quantity + handed_over_quantity),
  CHECK (picked_quantity <= quantity),
  FOREIGN KEY (fulfillment_request_id,reservation_id) REFERENCES fulfillment_requests(id,reservation_id) ON DELETE RESTRICT,
  FOREIGN KEY (reservation_line_id,reservation_id) REFERENCES reservation_lines(id,reservation_id) ON DELETE RESTRICT,
  UNIQUE(id,fulfillment_request_id,reservation_line_id)
);
ALTER TABLE scan_tasks ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE scan_tasks ADD COLUMN created_by_api_key_id UUID REFERENCES storefront_api_keys(id) ON DELETE RESTRICT;
ALTER TABLE scan_tasks ADD CONSTRAINT scan_task_creator CHECK (num_nonnulls(created_by,created_by_api_key_id) = 1);
ALTER TABLE scan_tasks ADD CONSTRAINT scan_task_fulfillment_fk FOREIGN KEY (fulfillment_request_id)
  REFERENCES fulfillment_requests(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX fulfillment_pick_task ON scan_tasks(fulfillment_request_id) WHERE task_type='PICK';

CREATE TABLE reservation_expiry_jobs (
  id UUID PRIMARY KEY, reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL, processed_at TIMESTAMPTZ,
  UNIQUE(reservation_id,expires_at)
);
CREATE TABLE workflow_commands (
  id UUID PRIMARY KEY, scope TEXT NOT NULL, request_key UUID NOT NULL, request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL, response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), UNIQUE(scope,request_key)
);
SELECT enforce_append_only_table('workflow_commands');

CREATE TABLE unit_confirmations (
  id UUID PRIMARY KEY, reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  fulfillment_request_id UUID NOT NULL, reservation_line_id UUID NOT NULL,
  sku_id UUID NOT NULL, allocation_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('PICK_TO_STAGING','RETURN_TO_SHELF')),
  method TEXT NOT NULL CHECK (method IN ('SCAN','MANUAL','AUTO_ASSUMED')),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND (method = 'AUTO_ASSUMED' OR quantity = 1)),
  scanned_identifier TEXT, reason TEXT, actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  trigger_api_key_id UUID REFERENCES storefront_api_keys(id) ON DELETE RESTRICT,
  trigger_call_id UUID,
  created_txid TEXT NOT NULL DEFAULT pg_current_xact_id()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (fulfillment_request_id,reservation_id) REFERENCES fulfillment_requests(id,reservation_id) ON DELETE RESTRICT,
  FOREIGN KEY (reservation_line_id,reservation_id,sku_id,allocation_id)
    REFERENCES reservation_lines(id,reservation_id,sku_id,allocation_id) ON DELETE RESTRICT,
  CHECK ((method = 'SCAN' AND actor_user_id IS NOT NULL AND scanned_identifier IS NOT NULL)
    OR (method = 'MANUAL' AND actor_user_id IS NOT NULL AND nullif(btrim(reason),'') IS NOT NULL)
    OR (method = 'AUTO_ASSUMED' AND actor_user_id IS NULL AND trigger_api_key_id IS NOT NULL AND trigger_call_id IS NOT NULL))
);
SELECT enforce_append_only_table('unit_confirmations');

CREATE TABLE fulfillment_history (
  id UUID PRIMARY KEY, fulfillment_request_id UUID NOT NULL REFERENCES fulfillment_requests(id) ON DELETE RESTRICT,
  from_status TEXT, to_status TEXT NOT NULL, action TEXT NOT NULL,
  confirmation TEXT CHECK (confirmation IN ('SCAN','MANUAL','AUTO_ASSUMED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('USER','STOREFRONT_SERVICE','SYSTEM_JOB','SYSTEM_WORKFLOW')),
  actor_id TEXT NOT NULL, trigger_api_key_id UUID REFERENCES storefront_api_keys(id) ON DELETE RESTRICT,
  trigger_call_id UUID, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT enforce_append_only_table('fulfillment_history');

ALTER TABLE stock_ledger ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE stock_ledger ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'USER',
  ADD COLUMN actor_api_key_id UUID REFERENCES storefront_api_keys(id) ON DELETE RESTRICT,
  ADD COLUMN actor_job_id UUID REFERENCES reservation_expiry_jobs(id) ON DELETE RESTRICT,
  ADD COLUMN actor_workflow_policy TEXT,
  ADD COLUMN trigger_api_key_id UUID REFERENCES storefront_api_keys(id) ON DELETE RESTRICT,
  ADD COLUMN trigger_call_id UUID,
  ADD COLUMN reservation_line_id UUID REFERENCES reservation_lines(id) ON DELETE RESTRICT,
  ADD COLUMN unit_confirmation_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE stock_ledger ADD COLUMN actor_id TEXT GENERATED ALWAYS AS
  (coalesce(actor_user_id::text,actor_api_key_id::text,actor_job_id::text,actor_workflow_policy)) STORED;
ALTER TABLE stock_ledger ADD CONSTRAINT ledger_actor CHECK (
  (actor_type='USER' AND actor_user_id IS NOT NULL AND num_nonnulls(actor_api_key_id,actor_job_id,actor_workflow_policy)=0)
  OR (actor_type='STOREFRONT_SERVICE' AND actor_api_key_id IS NOT NULL AND num_nonnulls(actor_user_id,actor_job_id,actor_workflow_policy)=0)
  OR (actor_type='SYSTEM_JOB' AND actor_job_id IS NOT NULL AND num_nonnulls(actor_user_id,actor_api_key_id,actor_workflow_policy)=0)
  OR (actor_type='SYSTEM_WORKFLOW' AND actor_workflow_policy='SIMPLIFIED_FULFILLMENT'
    AND num_nonnulls(actor_user_id,actor_api_key_id,actor_job_id)=0 AND trigger_api_key_id IS NOT NULL AND trigger_call_id IS NOT NULL)
);
-- Old M8 primitive history is retained; new workflows supply the line foreign key.
ALTER TABLE stock_ledger ADD CONSTRAINT ledger_reservation_fk FOREIGN KEY(reservation_id)
  REFERENCES reservations(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE stock_ledger ADD CONSTRAINT ledger_fulfillment_fk FOREIGN KEY(fulfillment_request_id)
  REFERENCES fulfillment_requests(id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE audit_logs ADD COLUMN actor_type TEXT, ADD COLUMN actor_id TEXT,
  ADD COLUMN trigger_api_key_id UUID REFERENCES storefront_api_keys(id) ON DELETE RESTRICT,
  ADD COLUMN trigger_call_id UUID;
ALTER TABLE audit_logs ADD CONSTRAINT audit_actor_pair CHECK ((actor_type IS NULL) = (actor_id IS NULL));

GRANT SELECT,INSERT,UPDATE ON reservations,reservation_items,reservation_lines,fulfillment_requests,
  fulfillment_request_lines,reservation_expiry_jobs TO hub_app;
GRANT SELECT,INSERT ON unit_confirmations,fulfillment_history,workflow_commands TO hub_app;
REVOKE DELETE ON reservations,reservation_items,reservation_lines,fulfillment_requests,
  fulfillment_request_lines,reservation_expiry_jobs FROM hub_app;

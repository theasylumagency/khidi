-- M3 S1. Future task types are schema-only; the service enables INTAKE_UNIQUE.
CREATE TABLE scan_tasks (
  id UUID PRIMARY KEY,
  task_type TEXT NOT NULL CHECK (task_type IN ('INTAKE_UNIQUE','PHYSICAL_COUNT','PHOTO_REQUEST','EVIDENCE_REQUEST','PICK')),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  assignee_user_id UUID REFERENCES users(id),
  assignee_role TEXT CHECK (assignee_role IN ('ADMIN','OPERATOR','STOCK_MANAGER','WAREHOUSE','ORDER_MANAGER')),
  product_type_id UUID REFERENCES product_types(id),
  target_sku_id UUID REFERENCES skus(id),
  pool_id UUID,
  fulfillment_request_id UUID,
  photos_required BOOLEAN NOT NULL DEFAULT TRUE,
  due_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
  target_count INTEGER CHECK (target_count > 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (num_nonnulls(assignee_user_id, assignee_role) = 1),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);
CREATE INDEX scan_tasks_assignee_user_idx ON scan_tasks(assignee_user_id, status);
CREATE INDEX scan_tasks_assignee_role_idx ON scan_tasks(assignee_role, status);

CREATE TABLE product_intakes (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES scan_tasks(id),
  source_mode TEXT NOT NULL CHECK (source_mode IN ('TASK','QUICK_SCAN')),
  scanned_by UUID NOT NULL REFERENCES users(id),
  -- Registered hardware identity is server-authenticated; desktops may have none.
  device_id UUID REFERENCES registered_devices(id),
  client_device_id UUID NOT NULL,
  scanned_identifiers_json JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(scanned_identifiers_json) = 'array'),
  normalized_identifier TEXT,
  is_no_barcode BOOLEAN NOT NULL DEFAULT FALSE,
  matched_sku_id UUID REFERENCES skus(id),
  duplicate_of_intake_id UUID,
  label_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (label_status IN ('NOT_REQUIRED','TO_PRINT','PRINTED','ATTACHED')),
  result_state TEXT NOT NULL CHECK (result_state IN ('PROCESSING','MATCHED_EXISTING','NEW_DRAFT','MANUAL_IDENTIFICATION_REQUIRED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id, task_id),
  FOREIGN KEY (duplicate_of_intake_id, task_id) REFERENCES product_intakes(id, task_id),
  CHECK ((source_mode = 'TASK') = (task_id IS NOT NULL)),
  CHECK (is_no_barcode = (normalized_identifier IS NULL)),
  CHECK (duplicate_of_intake_id IS NULL OR (task_id IS NOT NULL AND duplicate_of_intake_id <> id)),
  CHECK (result_state NOT IN ('MATCHED_EXISTING','NEW_DRAFT') OR matched_sku_id IS NOT NULL),
  CHECK (result_state <> 'MANUAL_IDENTIFICATION_REQUIRED' OR matched_sku_id IS NULL),
  CHECK (label_status = 'NOT_REQUIRED' OR is_no_barcode)
);
-- One original intake per normalized identifier per task; duplicates remain history.
CREATE UNIQUE INDEX product_intakes_task_identifier_uq
  ON product_intakes(task_id, normalized_identifier)
  WHERE duplicate_of_intake_id IS NULL AND normalized_identifier IS NOT NULL;
CREATE INDEX product_intakes_filter_idx ON product_intakes(result_state, label_status, created_at);
CREATE INDEX product_intakes_sku_label_idx ON product_intakes(matched_sku_id, label_status);

CREATE TABLE label_events (
  id UUID PRIMARY KEY,
  intake_id UUID NOT NULL REFERENCES product_intakes(id),
  from_status TEXT CHECK (from_status IN ('TO_PRINT','PRINTED')),
  to_status TEXT NOT NULL CHECK (to_status IN ('TO_PRINT','PRINTED','ATTACHED')),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  scan_intake_id UUID REFERENCES product_intakes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((from_status IS NULL AND to_status = 'TO_PRINT') OR
         (from_status = 'TO_PRINT' AND to_status = 'PRINTED') OR
         (from_status = 'PRINTED' AND to_status = 'ATTACHED'))
);
SELECT enforce_append_only_table('label_events');
GRANT SELECT, INSERT, UPDATE ON scan_tasks, product_intakes TO hub_app;
REVOKE DELETE ON scan_tasks, product_intakes FROM hub_app;
GRANT SELECT, INSERT ON label_events TO hub_app;
REVOKE UPDATE, DELETE ON label_events FROM hub_app;

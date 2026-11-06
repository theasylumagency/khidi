ALTER TABLE product_types ADD COLUMN distinguishing_attributes TEXT[] NOT NULL DEFAULT '{}';
UPDATE product_types
SET distinguishing_attributes = CASE WHEN key = 'MOTOBLOCK'
  THEN ARRAY['fuel_type', 'power_kw', 'transmission_gears', 'wheel_type']
  ELSE ARRAY(SELECT field->>'key' FROM jsonb_array_elements(attribute_schema_json) AS field
    WHERE field->>'tier' = 'REQUIRED_IDENTITY')
END;

ALTER TABLE skus
  ADD COLUMN identity_kind TEXT NOT NULL DEFAULT 'HOUSE_DEFINED'
    CHECK (identity_kind IN ('HOUSE_DEFINED', 'MANUFACTURER_IDENTIFIED')),
  ADD COLUMN identity_rule_version TEXT NOT NULL DEFAULT 'identity-rule-v1',
  ADD COLUMN identity_evidence_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN reverification_required BOOLEAN NOT NULL DEFAULT FALSE,
  DROP CONSTRAINT chk_skus_ready_requires_slug;

-- Earlier confidence was set manually. Existing approvals and slug history remain valid.
UPDATE skus SET identity_confidence = 'LOW', reverification_required = (lifecycle_state = 'READY');
ALTER TABLE skus ADD CONSTRAINT chk_skus_ready_requires_slug CHECK (
  lifecycle_state <> 'READY' OR (
    canonical_slug IS NOT NULL AND (
      identity_confidence IN ('HIGH', 'MEDIUM') OR reverification_required
    )
  )
);
CREATE INDEX idx_skus_reverification ON skus (id) WHERE reverification_required;

CREATE TABLE evidence (
  id UUID PRIMARY KEY,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  task_id UUID REFERENCES scan_tasks(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN (
    'PRODUCT_PLATE_PHOTO', 'PRODUCT_MARKING_PHOTO', 'PASSPORT_MANUAL', 'FACTORY_SPEC_SHEET',
    'SUPPLIER_DOCUMENT', 'MEASUREMENT', 'ADMIN_PHYSICAL_INSPECTION', 'PACKAGING_PHOTO',
    'CUSTOMS_DECLARATION', 'SUPPLIER_CORRESPONDENCE', 'SUPPLIER_CATALOG', 'STAFF_STATEMENT', 'PUBLIC_WEB'
  )),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('AI_ALLOWED', 'INTERNAL_ONLY')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  author_role TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  image_id UUID REFERENCES product_images(id) ON DELETE RESTRICT,
  private_storage_key TEXT,
  private_sha256 TEXT,
  private_mime_type TEXT,
  supplier_name TEXT,
  document_number TEXT,
  line_text TEXT,
  quantity INTEGER CHECK (quantity > 0),
  measurement_unit TEXT,
  measurement_method TEXT,
  notes TEXT,
  comparison_sku_id UUID REFERENCES skus(id) ON DELETE RESTRICT CHECK (comparison_sku_id <> sku_id),
  claims_json JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(claims_json) = 'object'),
  decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'PENDING' AND decided_by IS NULL AND decided_at IS NULL)
      OR (status IN ('ACCEPTED', 'REJECTED') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (type NOT IN ('SUPPLIER_DOCUMENT', 'ADMIN_PHYSICAL_INSPECTION', 'CUSTOMS_DECLARATION',
    'SUPPLIER_CORRESPONDENCE', 'SUPPLIER_CATALOG', 'STAFF_STATEMENT') OR sensitivity = 'INTERNAL_ONLY'),
  CHECK (type <> 'MEASUREMENT' OR image_id IS NOT NULL OR sensitivity = 'INTERNAL_ONLY'),
  CHECK (comparison_sku_id IS NULL OR (type = 'ADMIN_PHYSICAL_INSPECTION' AND length(trim(notes)) > 0)),
  CHECK ((private_storage_key IS NULL AND private_sha256 IS NULL AND private_mime_type IS NULL)
    OR (private_storage_key LIKE 'evidence/%' AND private_sha256 ~ '^[a-f0-9]{64}$'
      AND private_mime_type IN ('image/jpeg', 'image/png', 'image/webp') AND sensitivity = 'INTERNAL_ONLY'))
);
CREATE INDEX idx_evidence_sku ON evidence (sku_id, status);
CREATE INDEX idx_evidence_task ON evidence (task_id) WHERE task_id IS NOT NULL;

ALTER TABLE scan_tasks ADD CONSTRAINT evidence_request_contract CHECK (
  task_type <> 'EVIDENCE_REQUEST' OR (target_sku_id IS NOT NULL AND target_count > 0
    AND photo_request_note IS NOT NULL AND length(trim(photo_request_note)) BETWEEN 1 AND 4000
    AND requested_photo_slots_json IS NULL)
);

CREATE TABLE sku_field_provenance (
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL,
  value_json JSONB,
  status TEXT NOT NULL CHECK (status IN ('VERIFIED', 'UNVERIFIED', 'NOT_FOUND', 'CONFLICT')),
  evidence_ids UUID[] NOT NULL DEFAULT '{}',
  confirmed_evidence_id UUID REFERENCES evidence(id) ON DELETE RESTRICT,
  not_determinable_reason TEXT,
  decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  PRIMARY KEY (sku_id, field_name),
  CHECK ((status IN ('VERIFIED', 'UNVERIFIED') AND value_json IS NOT NULL)
    OR (status IN ('NOT_FOUND', 'CONFLICT') AND value_json IS NULL)),
  CHECK (confirmed_evidence_id IS NULL OR not_determinable_reason IS NULL),
  CHECK ((confirmed_evidence_id IS NULL AND not_determinable_reason IS NULL)
    OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

GRANT SELECT, INSERT, UPDATE ON evidence, sku_field_provenance TO hub_app;

-- Use each SKU's existing UUIDv7 as a deterministic key for this one-time notification.
INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json, correlation_id)
SELECT id, 'PRODUCT_REVIEW_REQUIRED', 'sku', id,
  jsonb_build_object('skuId', id, 'severity', 'ACTION_REQUIRED', 'reason', 'IDENTITY_REVERIFICATION', 'confidence', 'LOW'),
  id::text
FROM skus WHERE reverification_required;
INSERT INTO outbox_deliveries (id, outbox_event_id, consumer, status)
SELECT id, id, 'notifications', 'PENDING' FROM skus WHERE reverification_required;

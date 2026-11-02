-- ADR-005: persist business exceptions for administrator review.
ALTER TABLE product_intakes
  ADD COLUMN review_reason TEXT CHECK (review_reason IN ('UNKNOWN_INTERNAL_LABEL','ARCHIVED_INTERNAL_LABEL','IDENTIFIER_COLLISION','TASK_NOT_ACCEPTING','TASK_NOT_ASSIGNED')),
  ADD COLUMN review_original_reason TEXT CHECK (review_original_reason IN ('UNKNOWN_INTERNAL_LABEL','ARCHIVED_INTERNAL_LABEL','IDENTIFIER_COLLISION','TASK_NOT_ACCEPTING','TASK_NOT_ASSIGNED')),
  ADD COLUMN review_reference_sku_id UUID REFERENCES skus(id),
  ADD COLUMN scanned_identifier_type TEXT CHECK (scanned_identifier_type IN ('GTIN','UPC','MPN','FACTORY_MODEL','PLATE_VALUE','SUPPLIER_CODE','ACCOUNTING_CODE','INTERNAL_SKU','INTERNAL_QR','LEGACY_ALIAS')),
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN reviewed_by UUID REFERENCES users(id),
  ADD COLUMN review_resolution TEXT CHECK (review_resolution IN ('LINK_EXISTING','ACCEPT_FOR_TASK','DISMISS')),
  ADD COLUMN review_note TEXT,
  ADD COLUMN replacement_label_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN acceptance_response_json JSONB;

-- Preserve the existing collision history and correct its formerly counted progress.
UPDATE product_intakes SET review_reason = 'IDENTIFIER_COLLISION', review_original_reason = 'IDENTIFIER_COLLISION'
  WHERE result_state = 'MANUAL_IDENTIFICATION_REQUIRED';
UPDATE scan_tasks t SET completed_count = (
  SELECT count(*) FROM product_intakes i WHERE i.task_id = t.id
    AND i.duplicate_of_intake_id IS NULL AND i.review_reason IS NULL
    AND i.result_state IN ('NEW_DRAFT','MATCHED_EXISTING')
) WHERE EXISTS (SELECT 1 FROM product_intakes i WHERE i.task_id = t.id AND i.review_reason IS NOT NULL);
UPDATE product_intakes SET acceptance_response_json = jsonb_build_object(
  'id', id, 'matchedSkuId', matched_sku_id, 'resultState', result_state,
  'duplicateOfIntakeId', duplicate_of_intake_id,
  'labelStatus', CASE WHEN is_no_barcode THEN 'TO_PRINT' ELSE 'NOT_REQUIRED' END,
  'reviewReason', review_reason
);
ALTER TABLE product_intakes ALTER COLUMN acceptance_response_json SET NOT NULL;
ALTER TABLE product_intakes ADD CONSTRAINT intake_acceptance_object CHECK (jsonb_typeof(acceptance_response_json) = 'object');
ALTER TABLE product_intakes ADD CONSTRAINT intake_review_outcome_consistency CHECK (
  (review_resolution IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL AND review_note IS NULL) OR
  (review_resolution IS NOT NULL AND review_original_reason IS NOT NULL AND reviewed_at IS NOT NULL
    AND reviewed_by IS NOT NULL AND review_note IS NOT NULL AND length(btrim(review_note)) BETWEEN 1 AND 4000)
);
ALTER TABLE product_intakes ADD CONSTRAINT intake_review_origin CHECK (review_reason IS NULL OR review_original_reason IS NOT NULL);
ALTER TABLE product_intakes ADD CONSTRAINT intake_review_acceptance CHECK (
  review_resolution IS DISTINCT FROM 'ACCEPT_FOR_TASK' OR (review_reason IS NULL AND task_id IS NOT NULL)
);
ALTER TABLE product_intakes DROP CONSTRAINT product_intakes_check5;
ALTER TABLE product_intakes ADD CONSTRAINT intake_label_eligibility CHECK (
  label_status = 'NOT_REQUIRED' OR ((is_no_barcode OR replacement_label_requested) AND matched_sku_id IS NOT NULL)
);
ALTER TABLE product_intakes ADD CONSTRAINT intake_replacement_resolution CHECK (
  NOT replacement_label_requested OR (review_resolution IS NOT NULL AND review_resolution = 'LINK_EXISTING')
);
DROP INDEX product_intakes_task_identifier_uq;
CREATE UNIQUE INDEX product_intakes_task_identifier_uq ON product_intakes(task_id, normalized_identifier)
  WHERE duplicate_of_intake_id IS NULL AND normalized_identifier IS NOT NULL AND review_reason IS NULL;
CREATE INDEX product_intakes_needs_review_idx ON product_intakes(created_at) WHERE review_reason IS NOT NULL AND reviewed_at IS NULL;

-- Durable, append-only receipts also make review actions replay-safe after cache expiry.
CREATE TABLE intake_review_actions (
  id UUID PRIMARY KEY,
  intake_id UUID NOT NULL REFERENCES product_intakes(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  request_hash TEXT NOT NULL,
  response_json JSONB NOT NULL CHECK (jsonb_typeof(response_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT enforce_append_only_table('intake_review_actions');

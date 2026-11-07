-- Freeze the known side's accepted value as part of the acknowledgement.
ALTER TABLE sku_merge_acknowledgements ADD COLUMN expected_value_json jsonb;
ALTER TABLE sku_merge_acknowledgements ADD CONSTRAINT acknowledgement_has_unknown_side
  CHECK (source_unknown OR target_unknown);

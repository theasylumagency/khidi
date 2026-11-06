UPDATE product_types
SET attribute_schema_json = (
  SELECT jsonb_agg(
    CASE WHEN field->>'key' IN ('fuel_type', 'wheel_type', 'wheel_size', 'transmission_gears',
      'start_type', 'pto_shaft', 'part_category', 'shaft_type')
      THEN field || '{"observable":true}'::jsonb ELSE field END ORDER BY position)
  FROM jsonb_array_elements(attribute_schema_json) WITH ORDINALITY AS attributes(field, position)
)
WHERE jsonb_array_length(attribute_schema_json) > 0;

ALTER TABLE evidence
  ADD COLUMN comparison_image_id UUID REFERENCES product_images(id) ON DELETE RESTRICT,
  ADD COLUMN comparison_claims_json JSONB,
  ADD COLUMN comparison_claim_sources_json JSONB,
  ADD CONSTRAINT evidence_comparison_content CHECK (
    (comparison_image_id IS NULL AND comparison_claims_json IS NULL AND comparison_claim_sources_json IS NULL)
    OR (comparison_sku_id IS NOT NULL AND image_id IS NOT NULL AND comparison_image_id IS NOT NULL
      AND comparison_claims_json IS NOT NULL AND jsonb_typeof(comparison_claims_json) = 'object'
      AND comparison_claim_sources_json IS NOT NULL AND jsonb_typeof(comparison_claim_sources_json) = 'object')
  );
CREATE INDEX idx_evidence_compared_sku ON evidence(comparison_sku_id) WHERE comparison_sku_id IS NOT NULL;

CREATE FUNCTION enforce_evidence_comparison() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.comparison_sku_id IS NULL OR NEW.status = 'REJECTED' THEN
    RETURN NEW;
  END IF;
  IF NEW.type <> 'ADMIN_PHYSICAL_INSPECTION'
    OR NOT EXISTS (
      SELECT 1 FROM skus subject
      JOIN skus peer ON peer.id = NEW.comparison_sku_id AND peer.product_type_id = subject.product_type_id
      JOIN product_types pt ON pt.id = subject.product_type_id
      CROSS JOIN LATERAL jsonb_array_elements(pt.attribute_schema_json) AS definition(field)
      JOIN jsonb_each(NEW.comparison_claims_json) AS observed(key, value) ON observed.key = definition.field->>'key'
      WHERE subject.id = NEW.sku_id AND subject.lifecycle_state <> 'ARCHIVED' AND peer.lifecycle_state <> 'ARCHIVED'
        AND definition.field->'observable' = 'true'::jsonb
        AND jsonb_typeof(NEW.claims_json->observed.key) = jsonb_typeof(observed.value)
        AND CASE WHEN jsonb_typeof(observed.value) = 'string'
          THEN upper(btrim(regexp_replace(normalize(NEW.claims_json->>observed.key, NFKC), '[[:space:]]+', ' ', 'g')))
            <> upper(btrim(regexp_replace(normalize(observed.value #>> '{}', NFKC), '[[:space:]]+', ' ', 'g')))
          WHEN jsonb_typeof(observed.value) IN ('number', 'boolean') THEN NEW.claims_json->observed.key <> observed.value
          ELSE FALSE END
    ) THEN
    RAISE EXCEPTION 'A comparison requires different observable values on both SKUs.' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM product_images WHERE id = NEW.image_id AND sku_id = NEW.sku_id AND status = 'VERIFIED' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A comparison requires a verified photo of the subject SKU.' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM product_images WHERE id = NEW.comparison_image_id AND sku_id = NEW.comparison_sku_id AND status = 'VERIFIED' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A comparison requires a verified photo of the compared SKU.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evidence_comparison BEFORE INSERT OR UPDATE ON evidence
  FOR EACH ROW EXECUTE FUNCTION enforce_evidence_comparison();

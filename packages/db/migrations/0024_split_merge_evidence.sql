ALTER TABLE evidence ADD COLUMN comparison_relation TEXT NOT NULL DEFAULT 'DIFFERS'
  CHECK (comparison_relation IN ('DIFFERS','MATCHES'));
ALTER TABLE evidence ADD COLUMN acknowledged_unknowns_json JSONB NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(acknowledged_unknowns_json) = 'object');
ALTER TABLE evidence ADD COLUMN intake_id UUID REFERENCES product_intakes(id) ON DELETE RESTRICT,
  ADD COLUMN supporting_evidence_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN comparison_supporting_evidence_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE evidence DROP CONSTRAINT evidence_comparison_content;
ALTER TABLE evidence ADD CONSTRAINT evidence_comparison_content CHECK (
  (comparison_sku_id IS NULL AND comparison_claims_json IS NULL AND comparison_claim_sources_json IS NULL AND comparison_image_id IS NULL)
  OR (comparison_sku_id IS NOT NULL AND comparison_claims_json IS NOT NULL AND comparison_claim_sources_json IS NOT NULL
    AND ((type = 'ADMIN_PHYSICAL_INSPECTION' AND image_id IS NOT NULL AND comparison_image_id IS NOT NULL)
      OR (type = 'STAFF_STATEMENT' AND comparison_relation = 'DIFFERS'
        AND cardinality(supporting_evidence_ids) > 0 AND cardinality(comparison_supporting_evidence_ids) > 0)))
);
ALTER TABLE skus ADD COLUMN merged_undetermined_fields TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE skus ADD COLUMN split_basis_unverified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounting_mappings ADD COLUMN shared_item_confirmed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN shared_item_confirmed_at TIMESTAMPTZ,
  ADD CONSTRAINT accounting_shared_confirmation CHECK (
    (shared_item_confirmed_by IS NULL) = (shared_item_confirmed_at IS NULL));

CREATE TABLE sku_split_targets (
  source_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  target_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_sku_id,target_sku_id),
  CHECK (source_sku_id <> target_sku_id)
);
CREATE INDEX idx_split_targets_target ON sku_split_targets(target_sku_id);
SELECT enforce_append_only_table('sku_split_targets');

CREATE TABLE evidence_attributions (
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  source_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  target_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  claim_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  attributed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 4000),
  PRIMARY KEY (evidence_id,claim_sku_id,target_sku_id),
  FOREIGN KEY (source_sku_id,target_sku_id) REFERENCES sku_split_targets(source_sku_id,target_sku_id) ON DELETE RESTRICT
);
SELECT enforce_append_only_table('evidence_attributions');
CREATE INDEX idx_evidence_attributions_target ON evidence_attributions(target_sku_id);

CREATE TABLE image_attributions (
  image_id UUID NOT NULL REFERENCES product_images(id) ON DELETE RESTRICT,
  source_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  target_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  attributed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 4000),
  PRIMARY KEY (image_id,target_sku_id),
  FOREIGN KEY (source_sku_id,target_sku_id) REFERENCES sku_split_targets(source_sku_id,target_sku_id) ON DELETE RESTRICT
);
SELECT enforce_append_only_table('image_attributions');
CREATE INDEX idx_image_attributions_target ON image_attributions(target_sku_id);

CREATE TABLE sku_merge_acknowledgements (
  id UUID PRIMARY KEY,
  source_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  target_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 4000),
  source_unknown BOOLEAN NOT NULL,
  target_unknown BOOLEAN NOT NULL,
  source_lineage_ids UUID[] NOT NULL,
  target_lineage_ids UUID[] NOT NULL,
  acknowledged_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_sku_id,target_sku_id,field_name),
  CHECK (source_unknown OR target_unknown)
);
SELECT enforce_append_only_table('sku_merge_acknowledgements');
CREATE TABLE sku_split_basis (
  source_sku_id UUID NOT NULL,
  target_sku_id UUID NOT NULL,
  field_name TEXT NOT NULL,
  value_json JSONB NOT NULL,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  PRIMARY KEY(source_sku_id,target_sku_id,field_name),
  FOREIGN KEY (source_sku_id,target_sku_id) REFERENCES sku_split_targets(source_sku_id,target_sku_id) ON DELETE RESTRICT
);
SELECT enforce_append_only_table('sku_split_basis');
GRANT SELECT,INSERT ON sku_split_targets,evidence_attributions,image_attributions,sku_merge_acknowledgements TO hub_app;
GRANT SELECT,INSERT ON sku_split_basis TO hub_app;
REVOKE UPDATE,DELETE ON sku_split_targets,evidence_attributions,image_attributions,sku_merge_acknowledgements FROM hub_app;

ALTER TABLE sku_slug_history ADD COLUMN redirect_target_type TEXT NOT NULL DEFAULT 'SKU'
  CHECK (redirect_target_type IN ('SKU','CATEGORY'));
ALTER TABLE sku_slug_history ADD COLUMN redirect_category_id UUID REFERENCES categories(id) ON DELETE RESTRICT;
ALTER TABLE sku_slug_history ADD CONSTRAINT slug_redirect_category CHECK (
  (redirect_target_type = 'CATEGORY') = (redirect_category_id IS NOT NULL));

ALTER TABLE product_intakes DROP CONSTRAINT IF EXISTS product_intakes_review_reason_check;
ALTER TABLE product_intakes DROP CONSTRAINT IF EXISTS product_intakes_review_original_reason_check;
ALTER TABLE product_intakes ADD CONSTRAINT product_intakes_review_reason_check CHECK (
  review_reason IS NULL OR review_reason IN ('UNKNOWN_INTERNAL_LABEL','ARCHIVED_INTERNAL_LABEL','SPLIT_INTERNAL_LABEL',
    'IDENTIFIER_COLLISION','TASK_NOT_ACCEPTING','TASK_NOT_ASSIGNED'));
ALTER TABLE product_intakes ADD CONSTRAINT product_intakes_review_original_reason_check CHECK (
  review_original_reason IS NULL OR review_original_reason IN ('UNKNOWN_INTERNAL_LABEL','ARCHIVED_INTERNAL_LABEL','SPLIT_INTERNAL_LABEL',
    'IDENTIFIER_COLLISION','TASK_NOT_ACCEPTING','TASK_NOT_ASSIGNED'));

CREATE FUNCTION enforce_sku_split_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'skus' THEN
    IF EXISTS (SELECT 1 FROM sku_split_targets WHERE source_sku_id = NEW.id)
      AND (NEW.merged_into_sku_id IS NOT NULL OR NEW.lifecycle_state <> 'ARCHIVED') THEN
      RAISE EXCEPTION 'A split source must stay archived and cannot be merged.' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM skus source JOIN skus target ON target.id = NEW.target_sku_id
      WHERE source.id = NEW.source_sku_id AND source.lifecycle_state = 'ARCHIVED'
        AND source.merged_into_sku_id IS NULL AND target.lifecycle_state <> 'ARCHIVED'
        AND source.product_type_id IS NOT DISTINCT FROM target.product_type_id) THEN
      RAISE EXCEPTION 'Split lineage requires an archived source and an active target of the same type.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sku_split_lineage BEFORE INSERT ON sku_split_targets FOR EACH ROW EXECUTE FUNCTION enforce_sku_split_lineage();
CREATE TRIGGER sku_split_source BEFORE UPDATE ON skus FOR EACH ROW EXECUTE FUNCTION enforce_sku_split_lineage();
CREATE FUNCTION enforce_split_target_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM sku_split_targets WHERE source_sku_id = NEW.source_sku_id) < 2 THEN
    RAISE EXCEPTION 'A split requires at least two targets.' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER split_target_count AFTER INSERT ON sku_split_targets
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_split_target_count();

CREATE FUNCTION image_available_for_sku(image_uuid UUID, sku_uuid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE owners(id) AS (
    SELECT sku_id FROM product_images WHERE id = image_uuid
    UNION
    SELECT next.id FROM owners owner CROSS JOIN LATERAL (
      SELECT merged_into_sku_id AS id FROM skus WHERE id = owner.id AND lifecycle_state = 'ARCHIVED'
      UNION SELECT target_sku_id FROM image_attributions WHERE image_id = image_uuid AND source_sku_id = owner.id
    ) next WHERE next.id IS NOT NULL
  )
  SELECT EXISTS (SELECT 1 FROM owners WHERE id = sku_uuid)
$$;

CREATE OR REPLACE FUNCTION enforce_image_publication_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT image_available_for_sku(NEW.image_id,NEW.sku_id) THEN
    RAISE EXCEPTION 'Image publication requires ownership or explicit attribution.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_evidence_comparison() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  definition JSONB;
  peer_type UUID;
  subject_type UUID;
BEGIN
  IF NEW.comparison_sku_id IS NULL OR NEW.status = 'REJECTED' THEN RETURN NEW; END IF;
  SELECT product_type_id INTO subject_type FROM skus WHERE id = NEW.sku_id;
  SELECT product_type_id INTO peer_type FROM skus WHERE id = NEW.comparison_sku_id;
  IF NEW.type NOT IN ('ADMIN_PHYSICAL_INSPECTION','STAFF_STATEMENT') OR NEW.sku_id = NEW.comparison_sku_id
    OR subject_type IS NULL OR subject_type IS DISTINCT FROM peer_type
    OR (TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM skus WHERE id IN (NEW.sku_id,NEW.comparison_sku_id) AND lifecycle_state = 'ARCHIVED')) THEN
    RAISE EXCEPTION 'Compare two live SKUs of the same Product Type.' USING ERRCODE = '23514';
  END IF;
  IF NEW.comparison_relation = 'DIFFERS' THEN
    IF NEW.type = 'STAFF_STATEMENT' THEN
      IF cardinality(NEW.supporting_evidence_ids) = 0 OR cardinality(NEW.comparison_supporting_evidence_ids) = 0
        OR NOT EXISTS (SELECT 1 FROM jsonb_each(NEW.claims_json) a JOIN jsonb_each(NEW.comparison_claims_json) b USING (key)
          WHERE a.value IS DISTINCT FROM b.value) THEN
        RAISE EXCEPTION 'Candidate differences require supporting evidence on both sides.' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM product_types pt
      CROSS JOIN LATERAL jsonb_array_elements(pt.attribute_schema_json) definition(field)
      JOIN jsonb_each(NEW.comparison_claims_json) observed(key,value) ON observed.key = definition.field->>'key'
      WHERE pt.id = subject_type AND definition.field->'observable' = 'true'::jsonb
        AND NEW.claims_json ? observed.key
        AND upper(btrim(NEW.claims_json->>observed.key)) <> upper(btrim(observed.value #>> '{}'))) THEN
      RAISE EXCEPTION 'A comparison requires different observable values on both SKUs.' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.type <> 'ADMIN_PHYSICAL_INSPECTION' THEN
      RAISE EXCEPTION 'Sameness requires an admin inspection.' USING ERRCODE = '23514';
    END IF;
    FOR definition IN SELECT field FROM product_types pt
      CROSS JOIN LATERAL jsonb_array_elements(pt.attribute_schema_json) definition(field)
      WHERE pt.id = subject_type AND pt.distinguishing_attributes @> ARRAY[field->>'key']
        AND field->'observable' = 'true'::jsonb
    LOOP
      IF NOT (NEW.claims_json ? (definition->>'key') AND NEW.comparison_claims_json ? (definition->>'key'))
        OR upper(btrim(NEW.claims_json->>(definition->>'key'))) IS DISTINCT FROM
          upper(btrim(NEW.comparison_claims_json->>(definition->>'key'))) THEN
        RAISE EXCEPTION 'A sameness record requires every observable distinguishing value on both SKUs.' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM product_images WHERE id = NEW.image_id AND status = 'VERIFIED'
      AND image_available_for_sku(id,NEW.sku_id))
    OR NOT EXISTS (SELECT 1 FROM product_images WHERE id = NEW.comparison_image_id AND status = 'VERIFIED'
      AND image_available_for_sku(id,NEW.comparison_sku_id)) THEN
    RAISE EXCEPTION 'A comparison requires a verified photo of each SKU.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

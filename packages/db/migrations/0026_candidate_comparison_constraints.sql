ALTER TABLE evidence DROP CONSTRAINT evidence_check4;
ALTER TABLE evidence ADD CONSTRAINT evidence_comparison_type CHECK (
  comparison_sku_id IS NULL OR (type IN ('ADMIN_PHYSICAL_INSPECTION','STAFF_STATEMENT') AND length(btrim(notes)) > 0));

CREATE FUNCTION enforce_candidate_support() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.comparison_sku_id IS NOT NULL AND NEW.type = 'STAFF_STATEMENT' THEN
    IF EXISTS (SELECT 1 FROM unnest(NEW.supporting_evidence_ids || NEW.comparison_supporting_evidence_ids) reference(id)
      WHERE NOT EXISTS (SELECT 1 FROM evidence WHERE evidence.id = reference.id)) THEN
      RAISE EXCEPTION 'Candidate support must reference existing evidence.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evidence_candidate_support BEFORE INSERT OR UPDATE ON evidence FOR EACH ROW EXECUTE FUNCTION enforce_candidate_support();

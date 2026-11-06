ALTER TABLE evidence ADD COLUMN supersedes_evidence_id UUID REFERENCES evidence(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX idx_evidence_single_replacement ON evidence(supersedes_evidence_id)
  WHERE supersedes_evidence_id IS NOT NULL;

CREATE FUNCTION enforce_evidence_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Evidence is retained permanently.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'Evidence must start pending.' USING ERRCODE = '23514';
    END IF;
    IF NEW.supersedes_evidence_id IS NOT NULL THEN
      PERFORM 1 FROM evidence WHERE id = NEW.supersedes_evidence_id AND sku_id = NEW.sku_id
        AND status = 'ACCEPTED' FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A replacement requires accepted evidence for the same SKU.' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.supersedes_evidence_id IS DISTINCT FROM OLD.supersedes_evidence_id
    OR OLD.status = 'REJECTED'
    OR (OLD.status = 'ACCEPTED' AND NEW.status <> 'REJECTED') THEN
    RAISE EXCEPTION 'Invalid evidence transition.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'PENDING' AND COALESCE(NEW.decision_reason, '') !~ '[^[:space:]]' THEN
    RAISE EXCEPTION 'An evidence decision requires a reason.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'REJECTED' AND
    (to_jsonb(NEW) - ARRAY['status', 'decided_by', 'decided_at', 'decision_reason']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status', 'decided_by', 'decided_at', 'decision_reason']) THEN
    RAISE EXCEPTION 'A rejection must preserve evidence content.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evidence_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION enforce_evidence_lifecycle();

CREATE FUNCTION enforce_evidence_supersession() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM evidence WHERE id = NEW.supersedes_evidence_id
    AND sku_id = NEW.sku_id AND status = 'REJECTED') THEN
    RAISE EXCEPTION 'A replacement must reject the previous evidence in the same transaction.' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER evidence_supersession AFTER INSERT ON evidence
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.supersedes_evidence_id IS NOT NULL)
  EXECUTE FUNCTION enforce_evidence_supersession();

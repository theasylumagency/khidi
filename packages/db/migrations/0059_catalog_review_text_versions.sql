-- Preserve imported rows and old decisions. New approvals name an immutable text source.
ALTER TABLE catalog_review_proposals
  ADD COLUMN origin text NOT NULL DEFAULT 'IMPORT' CHECK (origin IN ('IMPORT', 'MANUAL')),
  ADD COLUMN created_by uuid REFERENCES users(id),
  ADD CONSTRAINT catalog_review_proposal_origin CHECK (
    (origin = 'IMPORT' AND created_by IS NULL)
    OR (origin = 'MANUAL' AND created_by IS NOT NULL AND field <> 'PHOTO')
  );

-- Only manual text entries may be created by the web role. Import remains operator-only.
CREATE FUNCTION check_catalog_review_manual_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'hub_app' AND NEW.origin <> 'MANUAL' THEN
    RAISE EXCEPTION 'Runtime can only create manual text proposals' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalog_review_manual_proposal
  BEFORE INSERT ON catalog_review_proposals FOR EACH ROW
  EXECUTE FUNCTION check_catalog_review_manual_proposal();
GRANT INSERT (id, product_id, field, original, proposed, observation, rationale, origin, created_by)
  ON catalog_review_proposals TO hub_app;

ALTER TABLE catalog_review_decisions
  ADD COLUMN approved_text text,
  ADD COLUMN approved_text_edit_id uuid,
  ADD CONSTRAINT catalog_review_decision_source_key UNIQUE (proposal_id, id),
  ADD CONSTRAINT catalog_review_decision_text_source_fk FOREIGN KEY (proposal_id, approved_text_edit_id)
    REFERENCES catalog_review_decisions(proposal_id, id),
  ADD CONSTRAINT catalog_review_approved_text_shape CHECK (
    (approved_text IS NULL AND approved_text_edit_id IS NULL)
    OR (action = 'APPROVE' AND field <> 'PHOTO' AND length(trim(approved_text)) > 0 AND approved_text IS NOT NULL)
  );

-- The nullable columns keep legacy history intact; every NEW text approval needs a snapshot.
CREATE FUNCTION check_catalog_review_approved_text() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_text text;
BEGIN
  IF NEW.action = 'APPROVE' AND NEW.field <> 'PHOTO' THEN
    IF NEW.approved_text_edit_id IS NULL THEN
      SELECT proposed INTO source_text FROM catalog_review_proposals WHERE id = NEW.proposal_id;
    ELSE
      SELECT edited_text INTO source_text FROM catalog_review_decisions
        WHERE id = NEW.approved_text_edit_id AND proposal_id = NEW.proposal_id AND action = 'EDIT'
          AND revision < NEW.revision;
    END IF;
    IF NEW.approved_text IS NULL OR source_text IS NULL OR NEW.approved_text IS DISTINCT FROM source_text THEN
      RAISE EXCEPTION 'Approval must match its exact text version' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalog_review_approved_text
  BEFORE INSERT ON catalog_review_decisions FOR EACH ROW
  EXECUTE FUNCTION check_catalog_review_approved_text();

CREATE INDEX idx_accounting_shared_item ON accounting_mappings(legal_entity_id,accounting_item_id) WHERE active;

CREATE FUNCTION enforce_shared_accounting_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(412629,5);
  IF EXISTS (SELECT 1 FROM accounting_mappings peer JOIN skus sku ON sku.id = peer.sku_id
    WHERE peer.sku_id <> NEW.sku_id AND peer.legal_entity_id = NEW.legal_entity_id
      AND peer.accounting_item_id = NEW.accounting_item_id AND peer.active AND sku.lifecycle_state <> 'ARCHIVED')
    AND (NEW.shared_item_confirmed_at IS NULL OR NOT EXISTS (
      SELECT 1 FROM users WHERE id = NEW.shared_item_confirmed_by AND active AND role = 'ADMIN')) THEN
    RAISE EXCEPTION 'A shared accounting item requires explicit admin confirmation.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shared_accounting_confirmation BEFORE INSERT OR UPDATE ON accounting_mappings
  FOR EACH ROW EXECUTE FUNCTION enforce_shared_accounting_confirmation();

CREATE FUNCTION enforce_merge_acknowledgement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (NEW.source_sku_id = ANY(NEW.source_lineage_ids) AND NEW.target_sku_id = ANY(NEW.target_lineage_ids))
    OR NEW.source_lineage_ids && NEW.target_lineage_ids
    OR NOT EXISTS (SELECT 1 FROM evidence item WHERE item.id = NEW.evidence_id
      AND item.type = 'ADMIN_PHYSICAL_INSPECTION' AND item.status = 'ACCEPTED' AND item.comparison_relation = 'MATCHES'
      AND ((item.sku_id = NEW.source_sku_id AND item.comparison_sku_id = NEW.target_sku_id)
        OR (item.sku_id = NEW.target_sku_id AND item.comparison_sku_id = NEW.source_sku_id))
      AND item.acknowledged_unknowns_json->>NEW.field_name = NEW.reason)
    OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.acknowledged_by AND active AND role = 'ADMIN') THEN
    RAISE EXCEPTION 'Acknowledgements require accepted sameness evidence, disjoint sides and an admin.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER merge_acknowledgement BEFORE INSERT ON sku_merge_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION enforce_merge_acknowledgement();

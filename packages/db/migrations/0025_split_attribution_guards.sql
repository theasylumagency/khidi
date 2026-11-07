CREATE FUNCTION enforce_asset_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_ids UUID[];
BEGIN
  WITH RECURSIVE lineage(id) AS (
    SELECT NEW.source_sku_id
    UNION SELECT sku.id FROM skus sku JOIN lineage ON sku.merged_into_sku_id = lineage.id
  ) SELECT array_agg(id) INTO source_ids FROM lineage;
  IF TG_TABLE_NAME = 'image_attributions' THEN
    IF NOT image_available_for_sku(NEW.image_id,NEW.source_sku_id) THEN
      RAISE EXCEPTION 'Attributed image must belong to the split source.' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM evidence WHERE id = NEW.evidence_id
      AND NEW.claim_sku_id IN (sku_id,comparison_sku_id)
      AND (NEW.claim_sku_id = ANY(source_ids) OR EXISTS (
        SELECT 1 FROM evidence_attributions a WHERE a.evidence_id = NEW.evidence_id
          AND a.claim_sku_id = NEW.claim_sku_id AND a.target_sku_id = ANY(source_ids)))) THEN
      RAISE EXCEPTION 'Attributed evidence must belong to the split source and selected side.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evidence_attribution_source BEFORE INSERT ON evidence_attributions FOR EACH ROW EXECUTE FUNCTION enforce_asset_attribution();
CREATE TRIGGER image_attribution_source BEFORE INSERT ON image_attributions FOR EACH ROW EXECUTE FUNCTION enforce_asset_attribution();

CREATE FUNCTION assert_sku_preinventory(sku_ids UUID[]) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE table_name TEXT; relation REGCLASS; column_name TEXT; occupied BOOLEAN;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['stock_pools','pool_sku_balances','allocation_balances','allocations','stock_ledger',
    'reservation_lines','fulfillment_request_lines','reconciliation_count_lines']
  LOOP
    relation := to_regclass(table_name);
    IF relation IS NULL THEN CONTINUE; END IF;
    FOR column_name IN SELECT attname FROM pg_attribute WHERE attrelid = relation
      AND attname IN ('sku_id','parent_bundle_sku_id') AND NOT attisdropped
    LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = ANY($1))',relation,column_name) INTO occupied USING sku_ids;
      IF occupied THEN RAISE EXCEPTION 'ADR-011 Part B: SKU has inventory or fulfillment history.' USING ERRCODE = '23514'; END IF;
    END LOOP;
  END LOOP;
END;
$$;

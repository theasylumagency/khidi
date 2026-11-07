-- Commitment-only operations lock allocation balances then insert ledger rows. Those inserts
-- take implicit SKU KEY SHARE locks. SKU non-key locks must be compatible to avoid a cycle.
CREATE OR REPLACE FUNCTION reject_archived_sku_price() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sku_state TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('price:' || NEW.sku_id::TEXT,0));
  SELECT lifecycle_state INTO sku_state FROM skus WHERE id=NEW.sku_id FOR NO KEY UPDATE;
  IF NEW.kind='SET' AND sku_state='ARCHIVED' THEN RAISE EXCEPTION 'Archived SKUs cannot receive SET prices'; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION validate_allocation_relationship() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id UUID; seller_id UUID; current_mode TEXT; sku_state TEXT;
BEGIN
  SELECT lifecycle_state INTO sku_state FROM skus WHERE id=NEW.sku_id FOR NO KEY UPDATE;
  IF sku_state='ARCHIVED' THEN RAISE EXCEPTION 'Archived SKUs cannot receive allocations'; END IF;
  SELECT owner_entity_id INTO owner_id FROM stock_pools WHERE id=NEW.pool_id;
  SELECT seller_entity_id INTO seller_id FROM storefronts WHERE id=NEW.storefront_id;
  IF owner_id <> seller_id THEN
    SELECT mode INTO current_mode FROM entity_relationships WHERE from_entity_id=owner_id AND to_entity_id=seller_id
      AND effective_from <= clock_timestamp() ORDER BY effective_from DESC,id DESC LIMIT 1;
    IF current_mode IS DISTINCT FROM 'CONSIGNMENT' THEN RAISE EXCEPTION 'Cross-entity allocation requires active CONSIGNMENT'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Match packages/domain/locking: price:<lowercase sku UUID>, then the SKU row.
-- This also covers direct single-row inserts, including withdrawal tombstones.
CREATE OR REPLACE FUNCTION reject_archived_sku_price() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sku_state TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('price:' || NEW.sku_id::TEXT,0));
  SELECT lifecycle_state INTO sku_state FROM skus WHERE id=NEW.sku_id FOR UPDATE;
  IF NEW.kind='SET' AND sku_state='ARCHIVED' THEN RAISE EXCEPTION 'Archived SKUs cannot receive SET prices'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER trg_archived_sku_price_guard ON storefront_prices;
CREATE TRIGGER trg_archived_sku_price_guard BEFORE INSERT ON storefront_prices
  FOR EACH ROW EXECUTE FUNCTION reject_archived_sku_price();

-- Serializes the first allocation with SKU corrections and inventory's stable candidate read.
CREATE OR REPLACE FUNCTION validate_allocation_relationship() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id UUID; seller_id UUID; current_mode TEXT; sku_state TEXT;
BEGIN
  SELECT lifecycle_state INTO sku_state FROM skus WHERE id=NEW.sku_id FOR UPDATE;
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

-- Snapshot dimensions cannot disagree with the allocation/pool they describe.
CREATE FUNCTION validate_stock_ledger_dimensions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pool_owner UUID; store_seller UUID; allocation_store UUID; location_kind TEXT;
BEGIN
  SELECT owner_entity_id INTO pool_owner FROM stock_pools WHERE id=NEW.pool_id;
  IF NEW.owner_entity_id IS DISTINCT FROM pool_owner THEN RAISE EXCEPTION 'Ledger owner differs from pool'; END IF;
  IF NEW.allocation_id IS NOT NULL THEN
    SELECT a.storefront_id,s.seller_entity_id INTO allocation_store,store_seller FROM allocations a JOIN storefronts s ON s.id=a.storefront_id WHERE a.id=NEW.allocation_id;
    IF NEW.storefront_id IS DISTINCT FROM allocation_store OR NEW.seller_entity_id IS DISTINCT FROM store_seller THEN
      RAISE EXCEPTION 'Ledger seller/storefront differs from allocation';
    END IF;
  END IF;
  IF NEW.location_id IS NOT NULL THEN
    SELECT kind INTO location_kind FROM pool_locations WHERE id=NEW.location_id;
    IF (NEW.movement_type IN ('PICK_TO_STAGING','HANDOVER_OUT') OR NEW.variant IN ('STAGING_RESERVED','STAGING_COMMITTED')) AND location_kind <> 'STAGING'
      OR (NEW.movement_type IN ('STOCK_IN','STOCK_OUT','WRITE_OFF','RETURN_TO_SHELF') OR NEW.variant IN ('SHELF_INCREASE','SHELF_DECREASE','CROSS_POOL')) AND location_kind <> 'SHELF' THEN
      RAISE EXCEPTION 'Ledger location does not match movement';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_dimensions BEFORE INSERT ON stock_ledger FOR EACH ROW EXECUTE FUNCTION validate_stock_ledger_dimensions();

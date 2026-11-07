CREATE FUNCTION assert_storefront_pool_drained(store_uuid UUID,pool_uuid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE open_fulfillment BOOLEAN;
BEGIN
  IF EXISTS(SELECT 1 FROM allocations a JOIN allocation_balances b ON b.allocation_id=a.id
    WHERE a.storefront_id=store_uuid AND a.pool_id=pool_uuid AND (b.allocated<>0 OR b.reserved<>0 OR b.committed<>0))
    OR EXISTS(SELECT 1 FROM stock_ledger l JOIN allocations a ON a.id=l.allocation_id
      WHERE a.storefront_id=store_uuid AND a.pool_id=pool_uuid GROUP BY a.id HAVING sum(l.staging_delta)<>0) THEN
    RAISE EXCEPTION 'AVAILABILITY_POOL_NOT_DRAINED' USING ERRCODE='23514';
  END IF;
  IF to_regclass('fulfillment_requests') IS NOT NULL AND to_regclass('fulfillment_request_lines') IS NOT NULL AND to_regclass('reservation_lines') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM fulfillment_requests f JOIN fulfillment_request_lines l ON l.fulfillment_request_id=f.id
      JOIN reservation_lines r ON r.id=l.reservation_line_id JOIN allocations a ON a.id=r.allocation_id
      WHERE a.storefront_id=$1 AND a.pool_id=$2 AND f.status NOT IN (''HANDED_OVER'',''CANCELLED''))' INTO open_fulfillment USING store_uuid,pool_uuid;
    IF open_fulfillment THEN RAISE EXCEPTION 'AVAILABILITY_POOL_NOT_DRAINED' USING ERRCODE='23514'; END IF;
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION guard_availability_pool() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id UUID; current_mode TEXT;
BEGIN
  IF TG_OP='UPDATE' AND OLD.availability_pool_id IS NOT NULL AND OLD.availability_pool_id IS DISTINCT FROM NEW.availability_pool_id THEN
    IF NEW.availability_pool_id IS NULL THEN RAISE EXCEPTION 'Active availability pool required'; END IF;
    PERFORM 1 FROM skus WHERE id IN (SELECT sku_id FROM allocations WHERE storefront_id=NEW.id AND pool_id IN (OLD.availability_pool_id,NEW.availability_pool_id)) ORDER BY id FOR NO KEY UPDATE;
    PERFORM 1 FROM pool_sku_balances b WHERE EXISTS(SELECT 1 FROM allocations a WHERE a.storefront_id=NEW.id AND a.pool_id IN (OLD.availability_pool_id,NEW.availability_pool_id) AND a.sku_id=b.sku_id AND a.pool_id=b.pool_id) ORDER BY pool_id,sku_id FOR UPDATE;
    PERFORM 1 FROM allocation_balances b JOIN allocations a ON a.id=b.allocation_id WHERE a.storefront_id=NEW.id AND a.pool_id IN (OLD.availability_pool_id,NEW.availability_pool_id) ORDER BY b.allocation_id FOR UPDATE OF b;
    PERFORM assert_storefront_pool_drained(NEW.id,OLD.availability_pool_id);
    -- Existing advanced stock in the destination cannot be silently discarded or adopted as a new declaration.
    PERFORM assert_storefront_pool_drained(NEW.id,NEW.availability_pool_id);
  END IF;
  IF NEW.availability_pool_id IS NOT NULL THEN
    SELECT owner_entity_id INTO owner_id FROM stock_pools WHERE id=NEW.availability_pool_id AND active;
    IF owner_id IS NULL THEN RAISE EXCEPTION 'Active availability pool required'; END IF;
    IF owner_id<>NEW.seller_entity_id THEN
      SELECT mode INTO current_mode FROM entity_relationships WHERE from_entity_id=owner_id AND to_entity_id=NEW.seller_entity_id
        AND effective_from<=clock_timestamp() ORDER BY effective_from DESC,id DESC LIMIT 1;
      IF current_mode IS DISTINCT FROM 'CONSIGNMENT' THEN RAISE EXCEPTION 'Availability pool requires CONSIGNMENT'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION guard_relationship_availability_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mode<>'CONSIGNMENT' AND EXISTS(SELECT 1 FROM storefronts s JOIN stock_pools p ON p.id=s.availability_pool_id
    WHERE s.seller_entity_id=NEW.to_entity_id AND p.owner_entity_id=NEW.from_entity_id) THEN
    RAISE EXCEPTION 'RELATIONSHIP_POOL_BINDING' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER relationship_availability_binding BEFORE INSERT OR UPDATE ON entity_relationships FOR EACH ROW EXECUTE FUNCTION guard_relationship_availability_binding();

CREATE FUNCTION assert_sku_inventory_drained(sku_uuid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE open_fulfillment BOOLEAN;
BEGIN
  -- Caller already holds the SKU non-key lock (an UPDATE takes it before its row trigger).
  PERFORM 1 FROM pool_sku_balances WHERE sku_id=sku_uuid ORDER BY pool_id,sku_id FOR UPDATE;
  PERFORM 1 FROM allocation_balances b JOIN allocations a ON a.id=b.allocation_id WHERE a.sku_id=sku_uuid ORDER BY b.allocation_id FOR UPDATE OF b;
  IF EXISTS(SELECT 1 FROM pool_sku_balances WHERE sku_id=sku_uuid AND (shelf<>0 OR staging<>0 OR allocated_total<>0))
    OR EXISTS(SELECT 1 FROM allocations a JOIN allocation_balances b ON b.allocation_id=a.id WHERE a.sku_id=sku_uuid AND (b.allocated<>0 OR b.reserved<>0 OR b.committed<>0)) THEN
    RAISE EXCEPTION 'SKU_INVENTORY_NOT_DRAINED' USING ERRCODE='23514';
  END IF;
  -- M9 owns these tables. Keep the guard active when that schema arrives; no M9 tables are created here.
  IF to_regclass('fulfillment_request_lines') IS NOT NULL AND to_regclass('fulfillment_requests') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM fulfillment_request_lines l JOIN fulfillment_requests f ON f.id=l.fulfillment_request_id
      WHERE (l.sku_id=$1 OR l.parent_bundle_sku_id=$1) AND f.status NOT IN (''HANDED_OVER'',''CANCELLED''))' INTO open_fulfillment USING sku_uuid;
    IF open_fulfillment THEN RAISE EXCEPTION 'SKU_INVENTORY_NOT_DRAINED' USING ERRCODE='23514'; END IF;
  END IF;
END;
$$;
CREATE FUNCTION guard_drained_sku_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lifecycle_state='ARCHIVED' AND OLD.lifecycle_state IS DISTINCT FROM 'ARCHIVED' THEN
    PERFORM assert_sku_inventory_drained(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER drained_sku_archive BEFORE UPDATE OF lifecycle_state ON skus FOR EACH ROW EXECUTE FUNCTION guard_drained_sku_archive();

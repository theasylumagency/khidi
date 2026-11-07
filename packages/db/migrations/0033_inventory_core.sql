CREATE TABLE stock_pools (
  id UUID PRIMARY KEY, owner_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (btrim(name) <> ''), location_note TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE pool_locations (
  id UUID PRIMARY KEY, pool_id UUID NOT NULL REFERENCES stock_pools(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('SHELF','STAGING')), name TEXT NOT NULL,
  UNIQUE(pool_id,kind), UNIQUE(id,pool_id)
);
CREATE TABLE allocations (
  id UUID PRIMARY KEY, pool_id UUID NOT NULL REFERENCES stock_pools(id) ON DELETE RESTRICT,
  storefront_id UUID NOT NULL REFERENCES storefronts(id) ON DELETE RESTRICT,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  minimum_stock INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(pool_id,storefront_id,sku_id), UNIQUE(id,pool_id,sku_id)
);
CREATE TABLE pool_sku_balances (
  pool_id UUID NOT NULL REFERENCES stock_pools(id) ON DELETE RESTRICT,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  shelf INTEGER NOT NULL DEFAULT 0 CHECK (shelf >= 0),
  staging INTEGER NOT NULL DEFAULT 0 CHECK (staging >= 0),
  allocated_total INTEGER NOT NULL DEFAULT 0 CHECK (allocated_total >= 0),
  unallocated INTEGER GENERATED ALWAYS AS (shelf + staging - allocated_total) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(pool_id,sku_id),
  CHECK (allocated_total <= shelf + staging), CHECK (staging <= allocated_total)
);
CREATE TABLE allocation_balances (
  allocation_id UUID PRIMARY KEY REFERENCES allocations(id) ON DELETE RESTRICT,
  allocated INTEGER NOT NULL DEFAULT 0 CHECK (allocated >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  committed INTEGER NOT NULL DEFAULT 0 CHECK (committed >= 0),
  available_to_sell INTEGER GENERATED ALWAYS AS (allocated - reserved - committed) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK (allocated >= reserved + committed)
);
CREATE TABLE stock_ledger (
  id UUID PRIMARY KEY, movement_type TEXT NOT NULL CHECK (movement_type IN (
    'STOCK_IN','STOCK_OUT','WRITE_OFF','ADJUSTMENT','PICK_TO_STAGING','RETURN_TO_SHELF','HANDOVER_OUT',
    'ALLOCATE','DEALLOCATE','TRANSFER_OUT','TRANSFER_IN','RESERVE','RESERVATION_RELEASE','COMMIT','COMMIT_RELEASE')),
  variant TEXT NOT NULL DEFAULT 'DEFAULT', quantity INTEGER NOT NULL CHECK (quantity > 0),
  pool_id UUID NOT NULL REFERENCES stock_pools(id) ON DELETE RESTRICT,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  allocation_id UUID, location_id UUID,
  shelf_delta INTEGER NOT NULL, staging_delta INTEGER NOT NULL, alloc_total_delta INTEGER NOT NULL,
  allocated_delta INTEGER NOT NULL, reserved_delta INTEGER NOT NULL, committed_delta INTEGER NOT NULL,
  owner_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  seller_entity_id UUID REFERENCES legal_entities(id) ON DELETE RESTRICT,
  storefront_id UUID REFERENCES storefronts(id) ON DELETE RESTRICT,
  relationship_mode TEXT CHECK (relationship_mode IN ('PURCHASE','CONSIGNMENT')),
  cross_entity BOOLEAN NOT NULL, document_ref TEXT CHECK (document_ref IS NULL OR btrim(document_ref) <> ''),
  reason TEXT, actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  correlation_id TEXT NOT NULL, reservation_id UUID, fulfillment_request_id UUID,
  payment_method TEXT CHECK (payment_method IN ('CARD','BANK_INSTALLMENT','CASH_ON_DELIVERY','PAY_ON_PICKUP')),
  count_line_id UUID, scan_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  seller_accounting_item_id TEXT, seller_accounting_name TEXT,
  owner_accounting_item_id TEXT, owner_accounting_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (allocation_id,pool_id,sku_id) REFERENCES allocations(id,pool_id,sku_id) ON DELETE RESTRICT,
  FOREIGN KEY (location_id,pool_id) REFERENCES pool_locations(id,pool_id) ON DELETE RESTRICT,
  CHECK ((allocation_id IS NULL) = (storefront_id IS NULL)),
  CHECK ((storefront_id IS NULL) = (seller_entity_id IS NULL)),
  CHECK (NOT cross_entity OR relationship_mode IS NOT NULL),
  CHECK (movement_type <> 'WRITE_OFF' OR nullif(btrim(reason),'') IS NOT NULL),
  CHECK (movement_type <> 'ADJUSTMENT' OR nullif(btrim(reason),'') IS NOT NULL),
  CHECK (movement_type <> 'COMMIT' OR reservation_id IS NOT NULL),
  CHECK (movement_type NOT IN ('RESERVE','RESERVATION_RELEASE','COMMIT_RELEASE','PICK_TO_STAGING','RETURN_TO_SHELF','HANDOVER_OUT') OR reservation_id IS NOT NULL),
  CHECK (movement_type NOT IN ('PICK_TO_STAGING','RETURN_TO_SHELF','HANDOVER_OUT') OR fulfillment_request_id IS NOT NULL),
  CHECK (movement_type <> 'RETURN_TO_SHELF' OR scan_confirmed),
  CHECK ((shelf_delta = 0 AND staging_delta = 0) OR location_id IS NOT NULL),
  CHECK (allocation_id IS NOT NULL OR (allocated_delta = 0 AND reserved_delta = 0 AND committed_delta = 0 AND alloc_total_delta = 0)),
  CHECK (ROW(shelf_delta,staging_delta,alloc_total_delta,allocated_delta,reserved_delta,committed_delta) =
    CASE
      WHEN movement_type = 'STOCK_IN' AND variant = 'DEFAULT' THEN ROW(quantity,0,0,0,0,0)
      WHEN movement_type IN ('STOCK_OUT','WRITE_OFF') AND variant = 'DEFAULT' THEN ROW(-quantity,0,0,0,0,0)
      WHEN movement_type = 'ADJUSTMENT' AND variant = 'SHELF_INCREASE' THEN ROW(quantity,0,0,0,0,0)
      WHEN movement_type = 'ADJUSTMENT' AND variant = 'SHELF_DECREASE' THEN ROW(-quantity,0,0,0,0,0)
      WHEN movement_type = 'ADJUSTMENT' AND variant = 'STAGING_RESERVED' THEN ROW(0,-quantity,-quantity,-quantity,-quantity,0)
      WHEN movement_type = 'ADJUSTMENT' AND variant = 'STAGING_COMMITTED' THEN ROW(0,-quantity,-quantity,-quantity,0,-quantity)
      WHEN movement_type = 'ALLOCATE' AND variant = 'DEFAULT' OR movement_type = 'TRANSFER_IN' AND variant = 'SAME_POOL' THEN ROW(0,0,quantity,quantity,0,0)
      WHEN movement_type = 'DEALLOCATE' AND variant = 'DEFAULT' OR movement_type = 'TRANSFER_OUT' AND variant = 'SAME_POOL' THEN ROW(0,0,-quantity,-quantity,0,0)
      WHEN movement_type = 'TRANSFER_OUT' AND variant = 'CROSS_POOL' THEN ROW(-quantity,0,0,0,0,0)
      WHEN movement_type = 'TRANSFER_IN' AND variant = 'CROSS_POOL' THEN ROW(quantity,0,0,0,0,0)
      WHEN movement_type = 'RESERVE' AND variant = 'DEFAULT' THEN ROW(0,0,0,0,quantity,0)
      WHEN movement_type = 'RESERVATION_RELEASE' AND variant = 'DEFAULT' THEN ROW(0,0,0,0,-quantity,0)
      WHEN movement_type = 'COMMIT' AND variant = 'DEFAULT' THEN ROW(0,0,0,0,-quantity,quantity)
      WHEN movement_type = 'COMMIT_RELEASE' AND variant = 'DEFAULT' THEN ROW(0,0,0,0,0,-quantity)
      WHEN movement_type = 'PICK_TO_STAGING' AND variant = 'DEFAULT' THEN ROW(-quantity,quantity,0,0,0,0)
      WHEN movement_type = 'RETURN_TO_SHELF' AND variant = 'DEFAULT' THEN ROW(quantity,-quantity,0,0,0,0)
      WHEN movement_type = 'HANDOVER_OUT' AND variant = 'DEFAULT' THEN ROW(0,-quantity,-quantity,-quantity,0,-quantity)
      ELSE ROW(NULL::INTEGER,NULL::INTEGER,NULL::INTEGER,NULL::INTEGER,NULL::INTEGER,NULL::INTEGER)
    END IS TRUE)
);
CREATE INDEX stock_ledger_pool_sku ON stock_ledger(pool_id,sku_id,id);
CREATE INDEX stock_ledger_reservation ON stock_ledger(allocation_id,reservation_id,id);
CREATE INDEX stock_ledger_correlation ON stock_ledger(correlation_id);
SELECT enforce_append_only_table('stock_ledger');

-- An allocation's identity and a pool's ownership cannot reinterpret ledger history.
CREATE FUNCTION guard_inventory_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'allocations' THEN
    IF ROW(OLD.pool_id,OLD.sku_id,OLD.storefront_id) IS DISTINCT FROM ROW(NEW.pool_id,NEW.sku_id,NEW.storefront_id) THEN
      RAISE EXCEPTION 'Allocation identity is immutable';
    END IF;
  ELSIF OLD.owner_entity_id IS DISTINCT FROM NEW.owner_entity_id THEN
    RAISE EXCEPTION 'Pool ownership is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER allocations_identity BEFORE UPDATE ON allocations FOR EACH ROW EXECUTE FUNCTION guard_inventory_identity();
CREATE TRIGGER pools_identity BEFORE UPDATE ON stock_pools FOR EACH ROW EXECUTE FUNCTION guard_inventory_identity();

CREATE FUNCTION validate_allocation_relationship() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id UUID; seller_id UUID; current_mode TEXT;
BEGIN
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
CREATE TRIGGER allocation_relationship BEFORE INSERT ON allocations FOR EACH ROW EXECUTE FUNCTION validate_allocation_relationship();

-- Invariant 2 is cross-row and must be checked after both aggregates are updated.
CREATE FUNCTION check_pool_allocation_sum() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p UUID; s UUID; total BIGINT; stored INTEGER;
BEGIN
  IF TG_TABLE_NAME='allocation_balances' THEN
    SELECT pool_id,sku_id INTO p,s FROM allocations WHERE id=NEW.allocation_id;
  ELSE p := NEW.pool_id; s := NEW.sku_id; END IF;
  SELECT coalesce(sum(b.allocated),0) INTO total FROM allocations a JOIN allocation_balances b ON b.allocation_id=a.id WHERE a.pool_id=p AND a.sku_id=s;
  SELECT allocated_total INTO stored FROM pool_sku_balances WHERE pool_id=p AND sku_id=s;
  IF stored IS NULL OR stored <> total THEN RAISE EXCEPTION 'Pool allocated_total differs from allocations' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER pool_allocation_sum AFTER INSERT OR UPDATE ON pool_sku_balances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_pool_allocation_sum();
CREATE CONSTRAINT TRIGGER allocation_pool_sum AFTER INSERT OR UPDATE ON allocation_balances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_pool_allocation_sum();

GRANT SELECT,INSERT,UPDATE ON stock_pools,pool_locations,allocations,pool_sku_balances,allocation_balances TO hub_app;
GRANT SELECT,INSERT ON stock_ledger TO hub_app;
REVOKE UPDATE,DELETE,TRUNCATE ON stock_ledger FROM hub_app;
REVOKE DELETE,TRUNCATE ON stock_pools,pool_locations,allocations,pool_sku_balances,allocation_balances FROM hub_app;

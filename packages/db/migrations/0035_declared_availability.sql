ALTER TABLE storefronts ADD COLUMN availability_pool_id UUID REFERENCES stock_pools(id) ON DELETE RESTRICT;
CREATE FUNCTION guard_availability_pool() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id UUID; current_mode TEXT;
BEGIN
  IF TG_OP='UPDATE' AND OLD.availability_pool_id IS NOT NULL AND OLD.availability_pool_id IS DISTINCT FROM NEW.availability_pool_id THEN
    RAISE EXCEPTION 'Availability pool is immutable after configuration';
  END IF;
  IF NEW.availability_pool_id IS NOT NULL THEN
    SELECT owner_entity_id INTO owner_id FROM stock_pools WHERE id=NEW.availability_pool_id AND active;
    IF owner_id IS NULL THEN RAISE EXCEPTION 'Active availability pool required'; END IF;
    IF owner_id <> NEW.seller_entity_id THEN
      SELECT mode INTO current_mode FROM entity_relationships WHERE from_entity_id=owner_id AND to_entity_id=NEW.seller_entity_id
        AND effective_from<=clock_timestamp() ORDER BY effective_from DESC,id DESC LIMIT 1;
      IF current_mode IS DISTINCT FROM 'CONSIGNMENT' THEN RAISE EXCEPTION 'Availability pool requires CONSIGNMENT'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER availability_pool_guard BEFORE INSERT OR UPDATE OF availability_pool_id ON storefronts FOR EACH ROW EXECUTE FUNCTION guard_availability_pool();

ALTER TABLE allocations ADD COLUMN alert_state TEXT NOT NULL DEFAULT 'NORMAL' CHECK(alert_state IN ('NORMAL','LOW_STOCK','OUT_OF_STOCK'));
CREATE TABLE replenishment_requests (
  id UUID PRIMARY KEY, allocation_id UUID NOT NULL REFERENCES allocations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('OPEN','ACKNOWLEDGED','FULFILLED','DECLINED')),
  requested_quantity INTEGER NOT NULL CHECK(requested_quantity>0),
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT, updated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX replenishment_one_open ON replenishment_requests(allocation_id) WHERE status IN ('OPEN','ACKNOWLEDGED');
CREATE TABLE inventory_notifications (
  id UUID PRIMARY KEY, allocation_id UUID NOT NULL REFERENCES allocations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('NORMAL','LOW_STOCK','OUT_OF_STOCK')),
  available_to_sell INTEGER NOT NULL CHECK(available_to_sell>=0),
  owner_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  recipient_user_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT enforce_append_only_table('inventory_notifications');
GRANT SELECT,INSERT,UPDATE ON replenishment_requests TO hub_app;
REVOKE DELETE,TRUNCATE ON replenishment_requests FROM hub_app;

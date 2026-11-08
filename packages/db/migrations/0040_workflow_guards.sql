CREATE FUNCTION guard_reservation_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.storefront_id,NEW.storefront_order_ref,NEW.payment_method,NEW.fulfillment_mode,
      NEW.created_by_api_key_id,NEW.idempotency_key,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.storefront_id,OLD.storefront_order_ref,OLD.payment_method,OLD.fulfillment_mode,
      OLD.created_by_api_key_id,OLD.idempotency_key,OLD.created_at) THEN
    RAISE EXCEPTION 'Reservation identity and fulfillment mode are frozen.' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('RELEASED','EXPIRED','HANDED_OVER') THEN
    RAISE EXCEPTION 'A terminal reservation is immutable.' USING ERRCODE='23514';
  END IF;
  IF OLD.status='COMMITTED' AND NEW.status NOT IN ('COMMITTED','RELEASED','HANDED_OVER') THEN
    RAISE EXCEPTION 'A commitment never expires or returns to reserved.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reservation_content BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION guard_reservation_content();
CREATE FUNCTION guard_reservation_line_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='reservation_items' THEN
    IF (to_jsonb(OLD)-'final_unit_price_minor') IS DISTINCT FROM (to_jsonb(NEW)-'final_unit_price_minor')
      OR OLD.final_unit_price_minor IS NOT NULL THEN
      RAISE EXCEPTION 'Reservation cart snapshots are frozen.' USING ERRCODE='23514';
    END IF;
  ELSIF (to_jsonb(OLD)-'released_quantity') IS DISTINCT FROM (to_jsonb(NEW)-'released_quantity')
    OR NEW.released_quantity < OLD.released_quantity THEN
    RAISE EXCEPTION 'Reservation component and accounting snapshots are frozen.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reservation_item_content BEFORE UPDATE ON reservation_items FOR EACH ROW EXECUTE FUNCTION guard_reservation_line_content();
CREATE TRIGGER reservation_line_content BEFORE UPDATE ON reservation_lines FOR EACH ROW EXECUTE FUNCTION guard_reservation_line_content();

CREATE FUNCTION guard_fulfillment_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot reservation_lines; parent_state TEXT;
BEGIN
  IF TG_TABLE_NAME='fulfillment_requests' THEN
    IF ROW(OLD.reservation_id,OLD.storefront_id,OLD.storefront_order_ref,OLD.delivery_method,OLD.ship_by,OLD.created_at)
      IS DISTINCT FROM ROW(NEW.reservation_id,NEW.storefront_id,NEW.storefront_order_ref,NEW.delivery_method,NEW.ship_by,NEW.created_at)
      OR OLD.status='HANDED_OVER' THEN
      RAISE EXCEPTION 'Fulfillment identity is frozen; handed-over requests are immutable.' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO snapshot FROM reservation_lines WHERE id=NEW.reservation_line_id;
    IF ROW(NEW.sku_id,NEW.parent_bundle_sku_id,NEW.allocation_id,NEW.quantity)
      IS DISTINCT FROM ROW(snapshot.sku_id,snapshot.parent_bundle_sku_id,snapshot.allocation_id,snapshot.quantity) THEN
      RAISE EXCEPTION 'Fulfillment must use the reservation snapshot.' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' THEN
      SELECT status INTO parent_state FROM fulfillment_requests WHERE id=OLD.fulfillment_request_id;
      IF parent_state='HANDED_OVER' OR ROW(OLD.fulfillment_request_id,OLD.reservation_id,OLD.reservation_line_id)
        IS DISTINCT FROM ROW(NEW.fulfillment_request_id,NEW.reservation_id,NEW.reservation_line_id) THEN
        RAISE EXCEPTION 'Handed-over lines and fulfillment identity are immutable.' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fulfillment_content BEFORE UPDATE ON fulfillment_requests FOR EACH ROW EXECUTE FUNCTION guard_fulfillment_content();
CREATE TRIGGER fulfillment_line_content BEFORE INSERT OR UPDATE ON fulfillment_request_lines FOR EACH ROW EXECUTE FUNCTION guard_fulfillment_content();

CREATE FUNCTION guard_unit_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen_mode TEXT; role_name TEXT;
BEGIN
  SELECT fulfillment_mode INTO frozen_mode FROM reservations WHERE id=NEW.reservation_id;
  SELECT role INTO role_name FROM users WHERE id=NEW.actor_user_id AND active;
  IF NEW.created_txid <> pg_current_xact_id()::text
    OR (NEW.method='MANUAL' AND coalesce(role_name NOT IN ('ADMIN','ORDER_MANAGER'),TRUE))
    OR (NEW.method='SCAN' AND coalesce(role_name NOT IN ('ADMIN','ORDER_MANAGER','WAREHOUSE'),TRUE))
    OR (NEW.method='AUTO_ASSUMED' AND (frozen_mode<>'SIMPLIFIED_FULFILLMENT' OR NEW.action<>'PICK_TO_STAGING')) THEN
    RAISE EXCEPTION 'Unit confirmation is not authorized for this reservation.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER unit_confirmation_guard BEFORE INSERT ON unit_confirmations FOR EACH ROW EXECUTE FUNCTION guard_unit_confirmation();

DO $$ DECLARE old_constraint RECORD;
BEGIN
  FOR old_constraint IN SELECT conname FROM pg_constraint WHERE conrelid='stock_ledger'::regclass
    AND contype='c' AND pg_get_constraintdef(oid) LIKE '%RETURN_TO_SHELF%scan_confirmed%' LOOP
    EXECUTE format('ALTER TABLE stock_ledger DROP CONSTRAINT %I',old_constraint.conname);
  END LOOP;
END $$;
CREATE TABLE stock_movement_confirmations (
  ledger_id UUID NOT NULL REFERENCES stock_ledger(id) ON DELETE RESTRICT,
  confirmation_id UUID NOT NULL UNIQUE REFERENCES unit_confirmations(id) ON DELETE RESTRICT,
  PRIMARY KEY(ledger_id,confirmation_id)
);
SELECT enforce_append_only_table('stock_movement_confirmations');
GRANT SELECT,INSERT ON stock_movement_confirmations TO hub_app;
CREATE FUNCTION prove_stock_unit_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total BIGINT; valid BOOLEAN; scanned BOOLEAN; evidence_count INTEGER;
BEGIN
  IF NEW.movement_type NOT IN ('PICK_TO_STAGING','RETURN_TO_SHELF') THEN
    IF cardinality(NEW.unit_confirmation_ids)>0 THEN RAISE EXCEPTION 'Unexpected unit proof.' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT sum(quantity),count(*),bool_and(
      reservation_id=NEW.reservation_id AND fulfillment_request_id=NEW.fulfillment_request_id
      AND sku_id=NEW.sku_id AND allocation_id=NEW.allocation_id
      AND (NEW.reservation_line_id IS NULL OR reservation_line_id=NEW.reservation_line_id)
      AND action=NEW.movement_type AND created_txid=pg_current_xact_id()::text
      AND ((NEW.actor_type='USER' AND actor_user_id=NEW.actor_user_id AND method IN ('SCAN','MANUAL'))
        OR (NEW.actor_type='SYSTEM_WORKFLOW' AND method='AUTO_ASSUMED'
          AND trigger_api_key_id=NEW.trigger_api_key_id AND trigger_call_id=NEW.trigger_call_id))),
    bool_and(method='SCAN')
    INTO total,evidence_count,valid,scanned FROM unit_confirmations WHERE id=ANY(NEW.unit_confirmation_ids);
  IF total IS DISTINCT FROM NEW.quantity::BIGINT OR valid IS DISTINCT FROM TRUE
    OR evidence_count<>cardinality(NEW.unit_confirmation_ids) OR NEW.scan_confirmed IS DISTINCT FROM scanned THEN
    RAISE EXCEPTION 'Movement requires matching unit confirmations in this transaction.' USING ERRCODE='23514';
  END IF;
  INSERT INTO stock_movement_confirmations(ledger_id,confirmation_id)
    SELECT NEW.id,unnest(NEW.unit_confirmation_ids);
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_unit_confirmation AFTER INSERT ON stock_ledger FOR EACH ROW EXECUTE FUNCTION prove_stock_unit_confirmation();

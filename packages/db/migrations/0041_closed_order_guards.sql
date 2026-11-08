CREATE FUNCTION guard_stock_order_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_state TEXT; snapshot reservation_lines;
BEGIN
  IF NEW.reservation_id IS NOT NULL THEN
    SELECT status INTO order_state FROM reservations WHERE id=NEW.reservation_id;
    IF order_state IN ('HANDED_OVER','RELEASED','EXPIRED') THEN
      RAISE EXCEPTION 'Closed orders cannot change stock.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.reservation_line_id IS NOT NULL THEN
    SELECT * INTO snapshot FROM reservation_lines WHERE id=NEW.reservation_line_id;
    IF ROW(NEW.reservation_id,NEW.sku_id,NEW.allocation_id)
      IS DISTINCT FROM ROW(snapshot.reservation_id,snapshot.sku_id,snapshot.allocation_id) THEN
      RAISE EXCEPTION 'Ledger line differs from the reservation snapshot.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_order_state BEFORE INSERT ON stock_ledger FOR EACH ROW EXECUTE FUNCTION guard_stock_order_state();
CREATE FUNCTION guard_closed_order_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM reservations WHERE id=OLD.reservation_id AND status IN ('HANDED_OVER','RELEASED','EXPIRED')) THEN
    RAISE EXCEPTION 'Closed order snapshots are immutable.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER closed_reservation_line BEFORE UPDATE ON reservation_lines FOR EACH ROW EXECUTE FUNCTION guard_closed_order_content();
CREATE TRIGGER closed_reservation_item BEFORE UPDATE ON reservation_items FOR EACH ROW EXECUTE FUNCTION guard_closed_order_content();

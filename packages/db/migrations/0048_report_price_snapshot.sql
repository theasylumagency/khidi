-- Existing reservations have no historical VAT snapshot. Leave it unknown.
ALTER TABLE reservation_items
  ADD COLUMN base_price_id uuid REFERENCES storefront_prices(id) ON DELETE RESTRICT,
  ADD COLUMN vat_included boolean,
  ADD CONSTRAINT reservation_price_snapshot_pair CHECK ((base_price_id IS NULL) = (vat_included IS NULL));

CREATE FUNCTION guard_report_price_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND
    (NEW.base_price_id,NEW.vat_included) IS DISTINCT FROM (OLD.base_price_id,OLD.vat_included) THEN
   RAISE EXCEPTION 'Reservation price snapshot is immutable';
 END IF;
 IF TG_OP='INSERT' AND NEW.base_price_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM storefront_prices p JOIN reservations r ON r.id=NEW.reservation_id
   WHERE p.id=NEW.base_price_id AND p.kind='SET' AND p.sku_id=NEW.sku_id
     AND p.storefront_id=r.storefront_id AND p.base_price_minor=NEW.base_price_minor
     AND p.currency=NEW.currency AND p.vat_included=NEW.vat_included
 ) THEN RAISE EXCEPTION 'Invalid reservation price snapshot'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reservation_report_price_snapshot BEFORE INSERT OR UPDATE ON reservation_items
FOR EACH ROW EXECUTE FUNCTION guard_report_price_snapshot();

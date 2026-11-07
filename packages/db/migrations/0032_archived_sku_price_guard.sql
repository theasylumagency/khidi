CREATE FUNCTION reject_archived_sku_price() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sku_state TEXT;
BEGIN
  SELECT lifecycle_state INTO sku_state FROM skus WHERE id = NEW.sku_id FOR SHARE;
  IF sku_state = 'ARCHIVED' THEN
    RAISE EXCEPTION 'Archived SKUs cannot receive SET prices';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_archived_sku_price_guard BEFORE INSERT ON storefront_prices
  FOR EACH ROW WHEN (NEW.kind = 'SET') EXECUTE FUNCTION reject_archived_sku_price();

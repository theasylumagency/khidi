-- Keys in existing/shared databases are retained. Only seed fixtures are renamed in code.
CREATE FUNCTION prevent_storefront_key_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'Storefront keys are immutable after creation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_storefront_key_immutable BEFORE UPDATE OF key ON storefronts
  FOR EACH ROW EXECUTE FUNCTION prevent_storefront_key_change();

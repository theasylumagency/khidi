-- Owner's M4 P4 clarification: photos attach to original intakes; existing verified slots are optional.
CREATE FUNCTION valid_intake_media_slots(value JSONB) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT CASE WHEN jsonb_typeof(value) <> 'array' THEN FALSE
    ELSE jsonb_array_length(value) = 0 OR valid_media_slots(value) END
$$;
GRANT EXECUTE ON FUNCTION valid_intake_media_slots(JSONB) TO hub_app;
ALTER TABLE intake_photo_status DROP CONSTRAINT intake_photo_status_required_slots_json_check,
  DROP CONSTRAINT intake_distinct_photo_slots,
  ADD CONSTRAINT intake_valid_required_slots CHECK (valid_intake_media_slots(required_slots_json)),
  ADD COLUMN covered_slots_json JSONB NOT NULL DEFAULT '[]' CHECK (valid_intake_media_slots(covered_slots_json));
UPDATE intake_photo_status p SET required_slots_json='[]',status='COMPLETE',attention_reason=NULL
  FROM product_intakes i WHERE i.id=p.intake_id AND i.duplicate_of_intake_id IS NOT NULL;
UPDATE product_intakes SET photos_missing=FALSE,photo_attention_reason=NULL WHERE duplicate_of_intake_id IS NOT NULL;

CREATE FUNCTION enforce_original_intake_photo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original product_intakes%ROWTYPE; expected_sku UUID;
BEGIN
  IF NEW.intake_id IS NOT NULL THEN
    SELECT * INTO STRICT original FROM product_intakes WHERE id=NEW.intake_id;
    IF original.duplicate_of_intake_id IS NOT NULL THEN RAISE EXCEPTION 'Photos must belong to the original intake'; END IF;
    expected_sku := CASE WHEN original.review_original_reason IS NULL OR original.review_resolution IN ('LINK_EXISTING','ACCEPT_FOR_TASK')
      THEN original.matched_sku_id ELSE NULL END;
    IF NEW.sku_id IS DISTINCT FROM expected_sku THEN RAISE EXCEPTION 'Photo SKU must follow explicit intake identification/review'; END IF;
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER product_images_original_intake BEFORE INSERT OR UPDATE OF intake_id,sku_id ON product_images
  FOR EACH ROW EXECUTE FUNCTION enforce_original_intake_photo();

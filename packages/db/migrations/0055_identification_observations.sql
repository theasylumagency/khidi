-- Separate generator/engine plates; checked absence is not a photo or an invented value.
CREATE OR REPLACE FUNCTION valid_media_slots(value JSONB) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE STRICT AS $$
 SELECT CASE WHEN jsonb_typeof(value)<>'array' THEN FALSE ELSE (
  SELECT count(*) BETWEEN 1 AND 5 AND count(DISTINCT slot)=count(*)
   AND bool_and(slot IN ('MAIN','SECONDARY','IDENTIFICATION','ENGINE_IDENTIFICATION','EXTRA'))
  FROM jsonb_array_elements_text(value) AS slots(slot)
 ) END
$$;
ALTER TABLE product_images DROP CONSTRAINT product_images_slot_check,
 ADD CONSTRAINT product_images_slot_check CHECK(slot IN ('MAIN','SECONDARY','IDENTIFICATION','ENGINE_IDENTIFICATION','EXTRA'));
ALTER TABLE scan_tasks DROP CONSTRAINT photo_request_contract,
 ADD CONSTRAINT photo_request_contract CHECK(task_type<>'PHOTO_REQUEST' OR (
  target_sku_id IS NOT NULL AND photo_request_note IS NOT NULL AND length(btrim(photo_request_note)) BETWEEN 1 AND 4000
  AND requested_photo_slots_json IS NOT NULL AND valid_media_slots(requested_photo_slots_json)));

CREATE TABLE identification_observations (
 id UUID PRIMARY KEY,
 sku_id UUID REFERENCES skus(id) ON DELETE RESTRICT,
 intake_id UUID REFERENCES product_intakes(id) ON DELETE RESTRICT,
 photo_request_task_id UUID REFERENCES scan_tasks(id) ON DELETE RESTRICT,
 slot TEXT NOT NULL CHECK(slot IN ('IDENTIFICATION','ENGINE_IDENTIFICATION')),
 field_name TEXT NOT NULL CHECK(field_name IN ('model_code','engine_model')),
 outcome TEXT NOT NULL CHECK(outcome IN ('PLATE_ABSENT','LATER')),
 status TEXT NOT NULL CHECK(status IN ('NOT_FOUND','PENDING')),
 reason TEXT NOT NULL CHECK(reason IN ('PLATE_ABSENT','CAPTURE_PENDING')),
 value_json JSONB CHECK(value_json IS NULL),
 author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 device_id UUID NOT NULL,
 captured_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls(sku_id,intake_id,photo_request_task_id)>=1),
 CHECK((slot='IDENTIFICATION' AND field_name='model_code') OR (slot='ENGINE_IDENTIFICATION' AND field_name='engine_model')),
 CHECK((outcome='PLATE_ABSENT' AND status='NOT_FOUND' AND reason='PLATE_ABSENT') OR
  (outcome='LATER' AND status='PENDING' AND reason='CAPTURE_PENDING'))
);
SELECT enforce_append_only_table('identification_observations');
GRANT SELECT,INSERT ON identification_observations TO hub_app;
CREATE INDEX identification_observations_intake_idx ON identification_observations(intake_id,created_at,id);
CREATE INDEX identification_observations_sku_idx ON identification_observations(sku_id,created_at,id);
ALTER TABLE sku_field_provenance ADD COLUMN observation_id UUID REFERENCES identification_observations(id) ON DELETE RESTRICT,
 ADD COLUMN observation_reason TEXT CHECK(observation_reason IS NULL OR (observation_reason='PLATE_ABSENT' AND observation_id IS NOT NULL AND status='NOT_FOUND' AND value_json IS NULL));

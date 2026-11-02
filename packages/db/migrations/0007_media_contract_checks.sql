-- Follow-up constraints; 0006 was already applied in local verification and is frozen.
CREATE FUNCTION valid_media_slots(value JSONB) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT CASE WHEN jsonb_typeof(value) <> 'array' THEN FALSE ELSE (
    SELECT count(*) BETWEEN 1 AND 4 AND count(DISTINCT slot) = count(*)
      AND bool_and(slot IN ('MAIN','SECONDARY','IDENTIFICATION','EXTRA'))
    FROM jsonb_array_elements_text(value) AS slots(slot)
  ) END
$$;
GRANT EXECUTE ON FUNCTION valid_media_slots(JSONB) TO hub_app;
ALTER TABLE scan_tasks ADD CONSTRAINT photo_request_distinct_slots
  CHECK (task_type <> 'PHOTO_REQUEST' OR valid_media_slots(requested_photo_slots_json));
ALTER TABLE intake_photo_status ADD CONSTRAINT intake_distinct_photo_slots CHECK (valid_media_slots(required_slots_json));
ALTER TABLE media_jobs ADD CONSTRAINT image_job_requires_version
  CHECK (job_type = 'publish-sku-media' OR (image_version IS NOT NULL AND image_version > 0));
ALTER TABLE image_master_versions ADD CONSTRAINT master_version_key_identity
  CHECK (storage_key LIKE 'master/' || image_id::text || '/v' || version::text || '/%');
ALTER TABLE image_publications ADD CONSTRAINT publication_master_exists
  FOREIGN KEY(image_id,master_version) REFERENCES image_master_versions(image_id,version) ON DELETE RESTRICT;
ALTER TABLE image_publications ADD CONSTRAINT neutral_public_media_key CHECK (
  object_key ~ ('^[a-z0-9-]+-[1-9][0-9]*-' || width::text || '[.]' || format || '$')
  AND object_key !~* 'kh-[0-9]{6,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
);

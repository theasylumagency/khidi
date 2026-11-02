-- M4 P2. Class A photos may await a SKU; all references retain history.
ALTER TABLE scan_tasks ADD COLUMN requested_photo_slots_json JSONB, ADD COLUMN photo_request_note TEXT,
  ADD CONSTRAINT photo_request_contract CHECK (task_type <> 'PHOTO_REQUEST' OR (
    target_sku_id IS NOT NULL AND photo_request_note IS NOT NULL AND length(btrim(photo_request_note)) BETWEEN 1 AND 4000
    AND requested_photo_slots_json IS NOT NULL AND jsonb_typeof(requested_photo_slots_json) = 'array'
    AND jsonb_array_length(requested_photo_slots_json) BETWEEN 1 AND 4
    AND requested_photo_slots_json <@ '["MAIN","SECONDARY","IDENTIFICATION","EXTRA"]'::jsonb));
ALTER TABLE product_intakes ADD COLUMN photos_missing BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN photo_attention_reason TEXT;

CREATE TABLE product_images (
  id UUID PRIMARY KEY,
  sku_id UUID REFERENCES skus(id) ON DELETE RESTRICT,
  intake_id UUID REFERENCES product_intakes(id) ON DELETE RESTRICT,
  photo_request_task_id UUID REFERENCES scan_tasks(id) ON DELETE RESTRICT,
  slot TEXT NOT NULL CHECK (slot IN ('MAIN','SECONDARY','IDENTIFICATION','EXTRA')),
  source_type TEXT NOT NULL DEFAULT 'WAREHOUSE' CHECK (source_type IN ('WAREHOUSE','MANUFACTURER','LEGACY_SITE')),
  source_url TEXT,
  role TEXT NOT NULL DEFAULT 'IDENTITY' CHECK (role IN ('MAIN','GALLERY','IDENTITY')),
  status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (status IN ('UNVERIFIED','VERIFIED','REJECTED','NEEDS_BETTER_SOURCE')),
  usage TEXT NOT NULL DEFAULT 'INTERNAL_EVIDENCE' CHECK (usage IN ('PUBLIC','INTERNAL_EVIDENCE')),
  raw_storage_key TEXT NOT NULL CHECK (raw_storage_key LIKE 'raw/' || id::text || '/%'),
  raw_sha256 TEXT NOT NULL CHECK (raw_sha256 ~ '^[a-f0-9]{64}$'),
  raw_bytes INTEGER NOT NULL CHECK (raw_bytes BETWEEN 1 AND 15728640), raw_version_id TEXT,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  width INTEGER NOT NULL CHECK (width > 0), height INTEGER NOT NULL CHECK (height > 0),
  captured_at TIMESTAMPTZ NOT NULL, device_id UUID NOT NULL,
  registered_device_id UUID REFERENCES registered_devices(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  reject_reason TEXT, master_storage_key TEXT, master_sha256 TEXT CHECK (master_sha256 ~ '^[a-f0-9]{64}$'),
  master_version INTEGER NOT NULL DEFAULT 0 CHECK (master_version >= 0),
  requested_version INTEGER NOT NULL DEFAULT 1 CHECK (requested_version > 0),
  derivatives_json JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(derivatives_json) = 'object'),
  tier1_quality_json JSONB NOT NULL CHECK (jsonb_typeof(tier1_quality_json) = 'object'),
  tier2_quality_json JSONB CHECK (jsonb_typeof(tier2_quality_json) = 'object'),
  perceptual_hash TEXT CHECK (perceptual_hash ~ '^[a-f0-9]{16}$'),
  processing_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (processing_status IN ('PENDING','PROCESSING','COMPLETED','RETRY','DEAD_LETTER')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verified_by UUID REFERENCES users(id) ON DELETE RESTRICT, verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id,sku_id), CHECK (num_nonnulls(sku_id,intake_id) >= 1),
  CHECK (width::bigint * height::bigint <= 64000000),
  CHECK (status <> 'REJECTED' OR (reject_reason IS NOT NULL AND length(btrim(reject_reason)) BETWEEN 1 AND 4000)),
  CHECK (status <> 'VERIFIED' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND master_version > 0)),
  CHECK ((master_version = 0 AND master_storage_key IS NULL AND master_sha256 IS NULL)
    OR (master_version > 0 AND master_storage_key IS NOT NULL AND master_sha256 IS NOT NULL)),
  CHECK (master_version <= requested_version)
);
CREATE INDEX product_images_sku_idx ON product_images(sku_id,sort_order,id);
CREATE INDEX product_images_intake_idx ON product_images(intake_id);
CREATE INDEX product_images_photo_task_idx ON product_images(photo_request_task_id);
CREATE INDEX product_images_phash_idx ON product_images(sku_id,perceptual_hash) WHERE perceptual_hash IS NOT NULL;

CREATE FUNCTION protect_image_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.raw_storage_key,NEW.raw_sha256,NEW.raw_bytes,NEW.raw_version_id,NEW.mime_type,
    NEW.width,NEW.height,NEW.captured_at,NEW.device_id,NEW.registered_device_id,NEW.idempotency_key,
    NEW.request_hash,NEW.created_by,NEW.created_at,NEW.intake_id,NEW.photo_request_task_id)
    IS DISTINCT FROM ROW(OLD.id,OLD.raw_storage_key,OLD.raw_sha256,OLD.raw_bytes,OLD.raw_version_id,OLD.mime_type,
    OLD.width,OLD.height,OLD.captured_at,OLD.device_id,OLD.registered_device_id,OLD.idempotency_key,
    OLD.request_hash,OLD.created_by,OLD.created_at,OLD.intake_id,OLD.photo_request_task_id) THEN
    RAISE EXCEPTION 'Image originals and capture identity are immutable';
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER product_images_original_immutable BEFORE UPDATE ON product_images FOR EACH ROW EXECUTE FUNCTION protect_image_original();

CREATE TABLE image_master_versions (
  id UUID PRIMARY KEY, image_id UUID NOT NULL REFERENCES product_images(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0), storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'), bytes INTEGER NOT NULL CHECK (bytes > 0),
  width INTEGER NOT NULL CHECK (width > 0), height INTEGER NOT NULL CHECK (height = width),
  storage_version_id TEXT, derivatives_json JSONB NOT NULL CHECK (jsonb_typeof(derivatives_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(image_id,version)
);
SELECT enforce_append_only_table('image_master_versions');
CREATE TABLE intake_photo_status (
  intake_id UUID PRIMARY KEY REFERENCES product_intakes(id) ON DELETE RESTRICT,
  required_slots_json JSONB NOT NULL CHECK (jsonb_typeof(required_slots_json) = 'array'
    AND jsonb_array_length(required_slots_json) BETWEEN 1 AND 4
    AND required_slots_json <@ '["MAIN","SECONDARY","IDENTIFICATION","EXTRA"]'::jsonb),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETE','ATTENTION')),
  attention_reason TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'ATTENTION' OR (attention_reason IS NOT NULL AND length(btrim(attention_reason)) BETWEEN 1 AND 4000))
);
INSERT INTO intake_photo_status(intake_id,required_slots_json)
  SELECT i.id,'["MAIN","SECONDARY","IDENTIFICATION"]'::jsonb FROM product_intakes i JOIN scan_tasks t ON t.id=i.task_id WHERE t.photos_required;
UPDATE product_intakes SET photos_missing=TRUE WHERE id IN (SELECT intake_id FROM intake_photo_status);
CREATE TABLE media_jobs (
  id UUID PRIMARY KEY, image_id UUID REFERENCES product_images(id) ON DELETE RESTRICT, sku_id UUID REFERENCES skus(id) ON DELETE RESTRICT,
  job_type TEXT NOT NULL CHECK (job_type IN ('process-image','tier2-image-check','publish-sku-media')),
  image_version INTEGER, dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','RETRY','COMPLETED','DEAD_LETTER')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0), max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  last_error TEXT, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((job_type='publish-sku-media' AND sku_id IS NOT NULL AND image_version IS NULL)
    OR (job_type<>'publish-sku-media' AND image_id IS NOT NULL AND image_version > 0))
);
CREATE INDEX media_jobs_pending_idx ON media_jobs(status,next_attempt_at);
CREATE TABLE media_actions (
  id UUID PRIMARY KEY, actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL, request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_json JSONB NOT NULL CHECK (jsonb_typeof(response_json)='object'), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT enforce_append_only_table('media_actions');
CREATE TABLE image_publications (
  id UUID PRIMARY KEY, image_id UUID NOT NULL, sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  master_version INTEGER NOT NULL CHECK (master_version > 0), object_key TEXT NOT NULL,
  width INTEGER NOT NULL CHECK (width IN (400,800,1600)), format TEXT NOT NULL CHECK (format IN ('webp','avif')),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'), status TEXT NOT NULL CHECK (status IN ('PUBLISHED','WITHDRAWN')),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), withdrawn_at TIMESTAMPTZ,
  FOREIGN KEY(image_id,sku_id) REFERENCES product_images(id,sku_id) ON DELETE RESTRICT,
  CHECK ((status='WITHDRAWN')=(withdrawn_at IS NOT NULL))
);
CREATE UNIQUE INDEX image_publications_live_key_uq ON image_publications(object_key) WHERE status='PUBLISHED';
CREATE INDEX image_publications_sku_idx ON image_publications(sku_id,status);
GRANT SELECT,INSERT,UPDATE ON product_images,intake_photo_status,media_jobs,image_publications TO hub_app;
REVOKE DELETE ON product_images,intake_photo_status,media_jobs,image_publications FROM hub_app;
GRANT SELECT,INSERT ON image_master_versions,media_actions TO hub_app;
REVOKE UPDATE,DELETE ON image_master_versions,media_actions FROM hub_app;

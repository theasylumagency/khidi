-- Photo workbench: edits of an existing gallery photo (local adjustment, AI clean-up, background,
-- in-use scene), OpenAI image models next to Gemini, and recorded rejections of a preview.
-- The table stays append-only; only its CHECK constraints are replaced with named ones.
ALTER TABLE catalog_review_photo_work
  ADD COLUMN settings jsonb CHECK (settings IS NULL OR jsonb_typeof(settings) = 'object'),
  ADD COLUMN note text CHECK (length(trim(note)) BETWEEN 1 AND 600);

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'catalog_review_photo_work'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) NOT LIKE '%settings%' AND pg_get_constraintdef(oid) NOT LIKE '%note%'
  LOOP
    EXECUTE format('ALTER TABLE catalog_review_photo_work DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE catalog_review_photo_work
  ADD CONSTRAINT photo_work_kind CHECK (kind IN ('UPLOAD','REQUEST','RENDER','PREVIEW','ACCEPT','FAILED','REJECT')),
  ADD CONSTRAINT photo_work_detail_text CHECK (length(trim(detail)) BETWEEN 1 AND 240),
  ADD CONSTRAINT photo_work_mode CHECK (mode IN ('INSET','MOUNT','ADJUST','CLEAN','BACKGROUND','SCENE')),
  ADD CONSTRAINT photo_work_model CHECK (model IN ('local','gemini-3.1-flash-image','gemini-3-pro-image',
    'gpt-image-2.6-sunburst','gpt-image-2.6-flare')),
  ADD CONSTRAINT photo_work_parent CHECK ((parent_id IS NULL) = (kind IN ('UPLOAD','REQUEST'))),
  ADD CONSTRAINT photo_work_base CHECK ((base_photo_id IS NOT NULL) = (kind = 'REQUEST')),
  -- A detail request carries the uploaded detail photo; an edit request works on its base photo only.
  ADD CONSTRAINT photo_work_photo CHECK ((photo_id IS NOT NULL) =
    (kind IN ('UPLOAD','PREVIEW','ACCEPT') OR kind = 'REQUEST' AND mode IN ('INSET','MOUNT'))),
  ADD CONSTRAINT photo_work_detail CHECK (CASE WHEN kind <> 'REQUEST' THEN detail IS NULL
    WHEN mode IN ('INSET','MOUNT','CLEAN','SCENE') THEN detail IS NOT NULL ELSE TRUE END),
  ADD CONSTRAINT photo_work_mode_kind CHECK ((mode IS NOT NULL) = (kind = 'REQUEST')),
  ADD CONSTRAINT photo_work_model_kind CHECK ((model IS NOT NULL) = (kind = 'RENDER')),
  ADD CONSTRAINT photo_work_placement CHECK (placement IS NULL OR kind IN ('RENDER','REQUEST')),
  ADD CONSTRAINT photo_work_settings CHECK (settings IS NULL OR kind = 'RENDER'),
  ADD CONSTRAINT photo_work_note CHECK ((note IS NOT NULL) = (kind = 'REJECT'));

CREATE UNIQUE INDEX catalog_review_preview_rejected ON catalog_review_photo_work(parent_id) WHERE kind = 'REJECT';

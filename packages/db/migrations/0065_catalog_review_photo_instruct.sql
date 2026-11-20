-- Free-form AI edit of a gallery photo ("remove the rust from the engine"). The instruction is the
-- request's detail; an optional square limits the edit. The table stays append-only.
ALTER TABLE catalog_review_photo_work
  DROP CONSTRAINT photo_work_mode,
  DROP CONSTRAINT photo_work_detail,
  ADD CONSTRAINT photo_work_mode CHECK (mode IN ('INSET','MOUNT','ADJUST','CLEAN','BACKGROUND','SCENE','INSTRUCT')),
  ADD CONSTRAINT photo_work_detail CHECK (CASE WHEN kind <> 'REQUEST' THEN detail IS NULL
    WHEN mode IN ('INSET','MOUNT','CLEAN','SCENE','INSTRUCT') THEN detail IS NOT NULL ELSE TRUE END);

ALTER TABLE skus ADD COLUMN merged_into_sku_id UUID REFERENCES skus(id) ON DELETE RESTRICT;
ALTER TABLE skus ADD CONSTRAINT chk_skus_merge_archive CHECK (
  merged_into_sku_id IS NULL OR (merged_into_sku_id <> id AND lifecycle_state = 'ARCHIVED')
);
CREATE INDEX idx_skus_merge_lineage ON skus(merged_into_sku_id) WHERE merged_into_sku_id IS NOT NULL;

ALTER TABLE product_intakes ADD COLUMN scanned_sku_id UUID REFERENCES skus(id) ON DELETE RESTRICT;

-- Merged images retain their original ownership and evidence references. A new
-- publication may target a SKU in that image's forward merge chain.
ALTER TABLE image_publications DROP CONSTRAINT image_publications_image_id_sku_id_fkey;
ALTER TABLE image_publications ADD CONSTRAINT image_publications_image_id_fkey
  FOREIGN KEY (image_id) REFERENCES product_images(id) ON DELETE RESTRICT;

CREATE FUNCTION enforce_image_publication_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    WITH RECURSIVE lineage(id, merged_into_sku_id) AS (
      SELECT sku.id, sku.merged_into_sku_id FROM product_images image JOIN skus sku ON sku.id = image.sku_id
        WHERE image.id = NEW.image_id
      UNION
      SELECT sku.id, sku.merged_into_sku_id FROM skus sku JOIN lineage ON sku.id = lineage.merged_into_sku_id
    )
    SELECT 1 FROM lineage WHERE id = NEW.sku_id
  ) THEN
    RAISE EXCEPTION 'Image publication must belong to the SKU or its merge lineage.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER image_publication_lineage BEFORE INSERT OR UPDATE OF image_id, sku_id ON image_publications
  FOR EACH ROW EXECUTE FUNCTION enforce_image_publication_lineage();

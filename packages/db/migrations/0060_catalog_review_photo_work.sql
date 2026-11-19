CREATE TABLE catalog_review_photo_work (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('UPLOAD','REQUEST','RENDER','PREVIEW','ACCEPT','FAILED')),
  parent_id uuid,
  base_photo_id uuid,
  photo_id uuid,
  detail text CHECK (length(trim(detail)) BETWEEN 1 AND 240),
  mode text CHECK (mode IN ('INSET','MOUNT')),
  model text CHECK (model IN ('local','gemini-3.1-flash-image','gemini-3-pro-image')),
  placement jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id,id),
  FOREIGN KEY(batch_id,product_id) REFERENCES catalog_legacy_products(batch_id,id),
  FOREIGN KEY(batch_id,photo_id) REFERENCES catalog_review_photos(batch_id,id),
  FOREIGN KEY(product_id,base_photo_id) REFERENCES catalog_review_photo_links(product_id,photo_id),
  FOREIGN KEY(product_id,parent_id) REFERENCES catalog_review_photo_work(product_id,id),
  CHECK ((parent_id IS NULL) = (kind IN ('UPLOAD','REQUEST'))),
  CHECK ((base_photo_id IS NOT NULL) = (kind = 'REQUEST')),
  CHECK ((photo_id IS NOT NULL) = (kind IN ('UPLOAD','REQUEST','PREVIEW','ACCEPT'))),
  CHECK ((detail IS NOT NULL) = (kind = 'REQUEST')),
  CHECK ((mode IS NOT NULL) = (kind = 'REQUEST')),
  CHECK ((model IS NOT NULL) = (kind = 'RENDER')),
  CHECK ((placement IS NOT NULL) = (kind IN ('RENDER','REQUEST')))
);
CREATE UNIQUE INDEX catalog_review_render_finished ON catalog_review_photo_work(parent_id) WHERE kind IN ('PREVIEW','FAILED');
CREATE UNIQUE INDEX catalog_review_request_accepted ON catalog_review_photo_work(parent_id) WHERE kind = 'ACCEPT';
CREATE INDEX catalog_review_product_work ON catalog_review_photo_work(product_id,created_at);
CREATE INDEX catalog_review_work_photo ON catalog_review_photo_work(product_id,photo_id);
GRANT SELECT, INSERT ON catalog_review_photo_work TO hub_app;
GRANT INSERT ON catalog_review_photos, catalog_review_photo_links TO hub_app;
SELECT enforce_append_only_table('catalog_review_photo_work');

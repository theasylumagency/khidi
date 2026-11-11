-- Legacy intake and editorial decisions are independent of canonical products and SKUs.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('ADMIN', 'OPERATOR', 'STOCK_MANAGER', 'WAREHOUSE', 'ORDER_MANAGER', 'CATALOG_REVIEWER')
);

CREATE TABLE catalog_review_batches (
  id uuid PRIMARY KEY,
  source_sha256 char(64) NOT NULL UNIQUE,
  sources jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE catalog_legacy_products (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES catalog_review_batches(id),
  wordpress_id integer NOT NULL CHECK (wordpress_id > 0),
  source_status text NOT NULL CHECK (source_status IN ('PUBLISHED', 'DRAFT')),
  baseline jsonb NOT NULL,
  review_source jsonb NOT NULL,
  UNIQUE (batch_id, wordpress_id),
  UNIQUE (batch_id, id)
);
CREATE TABLE catalog_review_assignments (
  batch_id uuid NOT NULL REFERENCES catalog_review_batches(id),
  user_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (batch_id, user_id)
);
CREATE TABLE catalog_review_photos (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES catalog_review_batches(id),
  asset_key text NOT NULL,
  source_url text NOT NULL,
  audit jsonb NOT NULL,
  raw_key text NOT NULL,
  raw_sha256 char(64) NOT NULL,
  raw_version text,
  preview_key text NOT NULL,
  preview_sha256 char(64) NOT NULL,
  preview_version text,
  UNIQUE (batch_id, asset_key),
  UNIQUE (batch_id, id)
);
CREATE TABLE catalog_review_photo_links (
  batch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  photo_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  FOREIGN KEY (batch_id, product_id) REFERENCES catalog_legacy_products(batch_id, id),
  FOREIGN KEY (batch_id, photo_id) REFERENCES catalog_review_photos(batch_id, id),
  PRIMARY KEY (product_id, position),
  UNIQUE (product_id, photo_id)
);
CREATE TABLE catalog_review_proposals (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES catalog_legacy_products(id),
  field text NOT NULL CHECK (field IN ('NAME', 'SHORT', 'FULL', 'PHOTO')),
  original text,
  proposed text,
  observation text NOT NULL CHECK (length(trim(observation)) > 0),
  rationale text NOT NULL CHECK (length(trim(rationale)) > 0),
  proposed_photo_id uuid,
  UNIQUE (product_id, field),
  FOREIGN KEY (product_id, proposed_photo_id)
    REFERENCES catalog_review_photo_links(product_id, photo_id),
  CHECK (
    (field = 'PHOTO' AND original IS NULL AND proposed IS NULL)
    OR (field <> 'PHOTO' AND proposed_photo_id IS NULL AND length(trim(proposed)) > 0 AND proposed IS NOT NULL)
  ),
  UNIQUE (id, product_id, field)
);
CREATE TABLE catalog_review_decisions (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL,
  product_id uuid NOT NULL,
  field text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('APPROVE', 'REJECT', 'EDIT', 'DEFER')),
  edited_text text,
  selected_photo_id uuid,
  note text CHECK (length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (proposal_id, product_id, field) REFERENCES catalog_review_proposals(id, product_id, field),
  FOREIGN KEY (product_id, selected_photo_id) REFERENCES catalog_review_photo_links(product_id, photo_id),
  UNIQUE (proposal_id, revision),
  CHECK ((action = 'EDIT') = (edited_text IS NOT NULL)),
  CHECK (edited_text IS NULL OR length(edited_text) BETWEEN 1 AND 20000),
  CHECK (field <> 'PHOTO' OR action <> 'EDIT'),
  CHECK ((selected_photo_id IS NOT NULL) = (field = 'PHOTO' AND action = 'APPROVE'))
);

-- Import and assignment are operator-only. The web runtime can append decisions.
GRANT SELECT ON catalog_review_batches, catalog_legacy_products, catalog_review_assignments,
  catalog_review_photos, catalog_review_photo_links, catalog_review_proposals, catalog_review_decisions TO hub_app;
GRANT INSERT ON catalog_review_decisions TO hub_app;
SELECT enforce_append_only_table('catalog_review_batches');
SELECT enforce_append_only_table('catalog_legacy_products');
SELECT enforce_append_only_table('catalog_review_photos');
SELECT enforce_append_only_table('catalog_review_photo_links');
SELECT enforce_append_only_table('catalog_review_proposals');
SELECT enforce_append_only_table('catalog_review_decisions');

CREATE TABLE catalog_feedback_entries (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES catalog_legacy_products(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL CHECK (revision > 0),
  submitted boolean NOT NULL,
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  card jsonb NOT NULL CHECK (jsonb_typeof(card) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, revision)
);
CREATE UNIQUE INDEX catalog_feedback_one_submission ON catalog_feedback_entries(product_id) WHERE submitted;
GRANT SELECT, INSERT ON catalog_feedback_entries TO hub_app;
SELECT enforce_append_only_table('catalog_feedback_entries');

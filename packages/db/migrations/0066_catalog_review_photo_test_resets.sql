-- Preserve append-only audit and media while hiding explicitly voided pilot photo experiments.
-- An operator records one immutable cutoff per actor/product after verifying scope.
-- Runtime may read these markers but may not insert or modify them.
CREATE TABLE catalog_review_photo_test_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  cutoff_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 4 AND 600),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (batch_id, product_id) REFERENCES catalog_legacy_products(batch_id, id),
  UNIQUE (product_id, actor_id, cutoff_at)
);
CREATE INDEX catalog_review_photo_test_reset_scope ON catalog_review_photo_test_resets (product_id, actor_id, cutoff_at);
GRANT SELECT ON catalog_review_photo_test_resets TO hub_app;
SELECT enforce_append_only_table('catalog_review_photo_test_resets');

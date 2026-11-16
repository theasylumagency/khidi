-- The first-pass checkpoint belongs to one assigned reviewer and one import batch.
ALTER TABLE catalog_legacy_products
  ADD COLUMN recommended_order integer CHECK (recommended_order BETWEEN 1 AND 20);
CREATE UNIQUE INDEX catalog_legacy_products_recommended_order
  ON catalog_legacy_products (batch_id, recommended_order) WHERE recommended_order IS NOT NULL;

CREATE TABLE catalog_review_checkpoints (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'array' AND jsonb_array_length(report) = 20),
  UNIQUE (batch_id, reviewer_id),
  FOREIGN KEY (batch_id, reviewer_id) REFERENCES catalog_review_assignments(batch_id, user_id)
);

CREATE INDEX catalog_review_decisions_actor_order
  ON catalog_review_decisions (actor_id, created_at, id);

GRANT SELECT, INSERT ON catalog_review_checkpoints TO hub_app;
GRANT UPDATE (viewed_at) ON catalog_review_checkpoints TO hub_app;

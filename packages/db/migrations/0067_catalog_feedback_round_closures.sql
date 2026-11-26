-- ADR-017: an administrator may close a pilot round before all twenty cards are submitted.
CREATE TABLE catalog_feedback_round_closures (
  round_no integer PRIMARY KEY CHECK (round_no > 0),
  batch_id uuid NOT NULL REFERENCES catalog_review_batches(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 1600),
  submitted_count integer NOT NULL CHECK (submitted_count BETWEEN 0 AND 19),
  draft_count integer NOT NULL CHECK (draft_count >= 0),
  untouched_count integer NOT NULL CHECK (untouched_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (submitted_count + draft_count + untouched_count = 20)
);
GRANT SELECT, INSERT ON catalog_feedback_round_closures TO hub_app;
SELECT enforce_append_only_table('catalog_feedback_round_closures');

-- ADR-017: the closing questions are optional, so a KEEP/CHANGE decision no longer requires a survey row.
ALTER TABLE catalog_feedback_round_decisions DROP CONSTRAINT catalog_feedback_round_decisions_round_no_fkey;
ALTER TABLE catalog_feedback_round_decisions ADD CONSTRAINT catalog_feedback_round_decisions_round_no_check CHECK (round_no > 0);

-- Explicit non-null guard: SQL CHECK otherwise accepts UNKNOWN for a null source.
ALTER TABLE label_events DROP CONSTRAINT label_events_check;
ALTER TABLE label_events ADD CONSTRAINT label_events_transition_check CHECK (
  (from_status IS NULL AND to_status = 'TO_PRINT') OR
  (from_status IS NOT NULL AND (
    (from_status = 'TO_PRINT' AND to_status = 'PRINTED') OR
    (from_status = 'PRINTED' AND to_status = 'ATTACHED')
  ))
);

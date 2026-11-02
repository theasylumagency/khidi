-- Fence delayed pg-boss executions/dead-letter receipts after an admin retry.
ALTER TABLE media_jobs ADD COLUMN generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0);

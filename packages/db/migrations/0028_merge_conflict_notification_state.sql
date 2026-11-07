ALTER TABLE skus ADD COLUMN merge_conflict_fields TEXT[] NOT NULL DEFAULT '{}';

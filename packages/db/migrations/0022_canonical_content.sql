ALTER TABLE skus ADD COLUMN content_review_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE sku_content_versions (
  id UUID PRIMARY KEY,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  locale TEXT NOT NULL CHECK (locale ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'),
  origin TEXT NOT NULL CHECK (origin IN ('MANUAL', 'DETERMINISTIC', 'AI_PROPOSAL')),
  author_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ai_job_id UUID REFERENCES ai_jobs(id) ON DELETE RESTRICT,
  imported BOOLEAN NOT NULL DEFAULT FALSE,
  display_name TEXT NOT NULL,
  short_description TEXT NOT NULL,
  full_description TEXT NOT NULL,
  search_aliases TEXT[] NOT NULL DEFAULT '{}',
  verified_facts JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(verified_facts) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sku_id, locale, id),
  CHECK ((origin = 'AI_PROPOSAL') = (ai_job_id IS NOT NULL)),
  CHECK (author_id IS NOT NULL OR ai_job_id IS NOT NULL OR (imported AND origin = 'MANUAL'))
);
CREATE INDEX idx_content_versions_sku ON sku_content_versions(sku_id, locale, created_at DESC);
SELECT enforce_append_only_table('sku_content_versions');
GRANT SELECT, INSERT ON sku_content_versions TO hub_app;

CREATE TABLE sku_content_approvals (
  sku_id UUID NOT NULL,
  locale TEXT NOT NULL,
  version_id UUID NOT NULL,
  approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sku_id, locale),
  FOREIGN KEY (sku_id, locale, version_id) REFERENCES sku_content_versions(sku_id, locale, id) ON DELETE RESTRICT
);
GRANT SELECT, INSERT, UPDATE ON sku_content_approvals TO hub_app;

-- PostgreSQL 16 also supports the legacy migration. Give imported records a v7
-- timestamp prefix and the variant and random bits of a generated UUID.
INSERT INTO sku_content_versions (id, sku_id, locale, origin, imported, display_name, short_description, full_description, search_aliases)
SELECT (lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0')
  || '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14))::uuid,
  sku.id, content.locale, 'MANUAL', TRUE, COALESCE(content.name, ''), COALESCE(content.short, ''),
  COALESCE(content.full_text, ''), content.aliases
FROM skus sku CROSS JOIN LATERAL (VALUES
  ('ka', display_name_ka, short_description_ka, full_description_ka, search_aliases_ka),
  ('en', display_name_en, short_description_en, full_description_en, search_aliases_en)
) AS content(locale, name, short, full_text, aliases)
WHERE content.name IS NOT NULL OR content.short IS NOT NULL OR content.full_text IS NOT NULL OR cardinality(content.aliases) > 0;

UPDATE skus SET content_review_required = TRUE WHERE lifecycle_state = 'READY';
WITH emitted AS (
  INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json, correlation_id)
  SELECT (lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0')
    || '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14))::uuid,
    'PRODUCT_REVIEW_REQUIRED', 'sku', id,
    jsonb_build_object('skuId', id, 'severity', 'ACTION_REQUIRED', 'reason', 'CONTENT_APPROVAL_REQUIRED', 'locales', ARRAY['ka']),
    id::text
  FROM skus WHERE content_review_required
  RETURNING id
)
INSERT INTO outbox_deliveries (id, outbox_event_id, consumer, status)
SELECT id, id, 'notifications', 'PENDING' FROM emitted;

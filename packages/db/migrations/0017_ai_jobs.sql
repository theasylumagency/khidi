CREATE TABLE ai_jobs (
  id UUID PRIMARY KEY,
  job_name TEXT NOT NULL CHECK (job_name IN (
    'identify-product', 'extract-evidence', 'ocr-label', 'normalize-specifications',
    'classify-product', 'generate-canonical-content', 'analyze-photo-quality', 'process-images'
  )),
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  evidence_id UUID REFERENCES evidence(id) ON DELETE RESTRICT,
  image_id UUID REFERENCES product_images(id) ON DELETE RESTRICT,
  image_version INTEGER CHECK (image_version > 0),
  dedupe_key TEXT NOT NULL UNIQUE,
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','RETRY','DEAD_LETTER','BUDGET_BLOCKED','SKIPPED')),
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((image_id IS NULL) = (image_version IS NULL))
);
CREATE INDEX idx_ai_jobs_status ON ai_jobs (status, updated_at);

CREATE TABLE ai_job_logs (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES ai_jobs(id) ON DELETE RESTRICT,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  budget_day TEXT NOT NULL CHECK (budget_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  reserved_usd_micros BIGINT NOT NULL CHECK (reserved_usd_micros >= 0),
  cost_usd_micros BIGINT CHECK (cost_usd_micros >= 0),
  input_tokens INTEGER CHECK (input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  status TEXT NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','BUDGET_BLOCKED','SKIPPED')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_ai_job_logs_budget ON ai_job_logs (budget_day);
CREATE INDEX idx_ai_job_logs_job ON ai_job_logs (job_id, created_at);
GRANT SELECT, INSERT, UPDATE ON ai_jobs, ai_job_logs TO hub_app;

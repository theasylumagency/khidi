-- 0002_product_model.sql
-- Milestone 2: Product Master, Taxonomy (8 Categories + UNCLASSIFIED), 30 Product Types,
-- Product Families, SKUs ([C8] nullable canonical_slug), Append-Only sku_slug_history ([C7, C8]),
-- Composed Bundles, Identifiers with Collision Detection, Accounting Mappings ([C9] legal_entity_id),
-- Storefront Listings (§4.5), and Legacy SEO URLs (§12.5).

-- Sequence for stable internal SKU allocation (e.g. AGT-000184, §5.4)
CREATE SEQUENCE IF NOT EXISTS internal_sku_seq START WITH 184 INCREMENT BY 1;

-- 1. Categories (§5.7: 8 public categories + internal UNCLASSIFIED)
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  parent_id UUID REFERENCES categories(id),
  name_ka TEXT NOT NULL,
  name_en TEXT NOT NULL,
  is_unclassified BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Product Types (§5.8: 30 initial types; extensible without schema changes)
CREATE TABLE IF NOT EXISTS product_types (
  id UUID PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  default_category_id UUID NOT NULL REFERENCES categories(id),
  name_ka TEXT NOT NULL,
  name_en TEXT NOT NULL,
  attribute_schema_json JSONB NOT NULL,
  photo_instructions_json JSONB NOT NULL,
  naming_template_ka TEXT NOT NULL,
  naming_template_en TEXT NOT NULL,
  ai_research_contract_json JSONB NOT NULL,
  search_aliases_ka TEXT[] NOT NULL DEFAULT '{}',
  search_aliases_en TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Product Families (§5.1)
CREATE TABLE IF NOT EXISTS product_families (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  product_type_id UUID REFERENCES product_types(id),
  category_id UUID REFERENCES categories(id),
  brand TEXT,
  manufacturer TEXT,
  base_model TEXT,
  title_ka TEXT NOT NULL,
  title_en TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. SKUs / Variants (§5.1 - §5.12, §15.1, [C8])
CREATE TABLE IF NOT EXISTS skus (
  id UUID PRIMARY KEY,
  internal_sku TEXT NOT NULL UNIQUE,
  product_family_id UUID REFERENCES product_families(id),
  product_type_id UUID REFERENCES product_types(id),
  category_id UUID NOT NULL REFERENCES categories(id),
  canonical_slug TEXT, -- [C8] NULL-able at intake; required when lifecycle_state = 'READY'
  lifecycle_state TEXT NOT NULL DEFAULT 'INTAKE' CHECK (lifecycle_state IN (
    'INTAKE', 'IDENTIFYING', 'IDENTIFICATION_REQUIRED', 'IDENTIFIED',
    'ACCOUNTING_MAPPING_REQUIRED', 'CONTENT_GENERATING', 'CONTENT_REVIEW',
    'READY', 'ARCHIVED'
  )),
  identity_confidence TEXT NOT NULL DEFAULT 'LOW' CHECK (identity_confidence IN (
    'HIGH', 'MEDIUM', 'LOW', 'CONFLICT'
  )),
  is_composed_bundle BOOLEAN NOT NULL DEFAULT FALSE,
  is_kit BOOLEAN NOT NULL DEFAULT FALSE,
  kit_components_json JSONB,
  brand TEXT,
  manufacturer TEXT,
  model_code TEXT,
  key_differentiator_ka TEXT,
  key_differentiator_en TEXT,

  -- Universal normalized units (§5.6)
  power_kw NUMERIC(10,3),
  engine_displacement_cm3 NUMERIC(10,2),
  length_mm NUMERIC(10,2),
  width_mm NUMERIC(10,2),
  height_mm NUMERIC(10,2),
  working_width_mm NUMERIC(10,2),
  working_depth_mm NUMERIC(10,2),
  weight_kg NUMERIC(10,3),
  volume_l NUMERIC(10,3),
  pressure_bar NUMERIC(10,2),
  flow_l_min NUMERIC(10,2),
  voltage_v NUMERIC(10,2),
  current_a NUMERIC(10,2),
  unit_source_strings_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Schema-driven type attributes (§5.9)
  type_attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Canonical factual content (§5.10, §5.12)
  display_name_ka TEXT,
  display_name_en TEXT,
  short_description_ka TEXT,
  short_description_en TEXT,
  full_description_ka TEXT,
  full_description_en TEXT,
  search_aliases_ka TEXT[] NOT NULL DEFAULT '{}',
  search_aliases_en TEXT[] NOT NULL DEFAULT '{}',

  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- [C8] READY requires non-null canonical_slug
  CONSTRAINT chk_skus_ready_requires_slug CHECK (
    lifecycle_state <> 'READY' OR canonical_slug IS NOT NULL
  ),
  -- Composed bundle and factory kit are mutually exclusive (§5.2)
  CONSTRAINT chk_skus_bundle_or_kit_exclusive CHECK (
    NOT (is_composed_bundle AND is_kit)
  )
);

-- [C8] Partial unique index on non-null canonical_slug
CREATE UNIQUE INDEX IF NOT EXISTS idx_skus_canonical_slug
  ON skus (canonical_slug)
  WHERE canonical_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_skus_lifecycle_state ON skus (lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_skus_product_type ON skus (product_type_id);
CREATE INDEX IF NOT EXISTS idx_skus_category ON skus (category_id);

-- 5. SKU Slug History — Append-Only (§5.11, [C7, C8])
CREATE TABLE IF NOT EXISTS sku_slug_history (
  id UUID PRIMARY KEY,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  old_slug TEXT NOT NULL UNIQUE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- [C7] Enforce append-only trigger on sku_slug_history
SELECT enforce_append_only_table('sku_slug_history');

-- 6. Composed Bundle Components (§5.2)
CREATE TABLE IF NOT EXISTS bundle_components (
  bundle_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  component_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (bundle_sku_id, component_sku_id),
  CONSTRAINT chk_bundle_not_self CHECK (bundle_sku_id <> component_sku_id)
);

-- 7. SKU Identifiers & Barcodes (§5.3)
CREATE TABLE IF NOT EXISTS sku_identifiers (
  id UUID PRIMARY KEY,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN (
    'GTIN', 'UPC', 'MPN', 'FACTORY_MODEL', 'PLATE_VALUE',
    'SUPPLIER_CODE', 'ACCOUNTING_CODE', 'INTERNAL_SKU',
    'INTERNAL_QR', 'LEGACY_ALIAS'
  )),
  value TEXT NOT NULL,
  issuer_source TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  has_collision BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sku_id, identifier_type, value)
);

CREATE INDEX IF NOT EXISTS idx_sku_identifiers_lookup
  ON sku_identifiers (identifier_type, value);

CREATE INDEX IF NOT EXISTS idx_sku_identifiers_value
  ON sku_identifiers (value);

-- 8. Accounting Mappings (§5.5, [C9]: legal_entity_id)
CREATE TABLE IF NOT EXISTS accounting_mappings (
  id UUID PRIMARY KEY,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id), -- [C9]
  accounting_item_id TEXT NOT NULL,
  accounting_name TEXT NOT NULL,
  legacy_code TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- [C9] Partial index for active accounting mappings per (sku_id, legal_entity_id)
CREATE INDEX IF NOT EXISTS idx_accounting_mappings_sku_entity
  ON accounting_mappings (sku_id, legal_entity_id)
  WHERE active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_mappings_unique_active_item
  ON accounting_mappings (sku_id, legal_entity_id, accounting_item_id)
  WHERE active = TRUE;

-- 9. Storefront Listings (§4.5)
CREATE TABLE IF NOT EXISTS storefront_listings (
  id UUID PRIMARY KEY,
  storefront_id UUID NOT NULL REFERENCES storefronts(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_at TIMESTAMPTZ,
  enabled_by UUID REFERENCES users(id),
  disabled_at TIMESTAMPTZ,
  disabled_by UUID REFERENCES users(id),
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (storefront_id, sku_id)
);

-- 10. Legacy SEO URLs (§12.5)
CREATE TABLE IF NOT EXISTS legacy_urls (
  id UUID PRIMARY KEY,
  old_host TEXT NOT NULL,
  old_path_raw TEXT NOT NULL,
  old_path_normalized TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('PRODUCT', 'CATEGORY', 'OTHER')),
  entity_id UUID,
  decision TEXT NOT NULL DEFAULT 'UNDECIDED' CHECK (decision IN (
    'KEEP_301', 'ARCHIVE_PAGE', 'GONE_410', 'UNDECIDED'
  )),
  gsc_clicks_16m INTEGER,
  gsc_impressions_16m INTEGER,
  backlinks INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (old_host, old_path_normalized)
);

-- 11. Role Privileges for hub_app ([C7])
GRANT USAGE, SELECT ON SEQUENCE internal_sku_seq TO hub_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  categories,
  product_types,
  product_families,
  skus,
  bundle_components,
  sku_identifiers,
  accounting_mappings,
  storefront_listings,
  legacy_urls
TO hub_app;

-- [C7] Strictly forbid UPDATE, DELETE, TRUNCATE on append-only sku_slug_history for hub_app
REVOKE UPDATE, DELETE, TRUNCATE ON sku_slug_history FROM hub_app;
GRANT SELECT, INSERT ON sku_slug_history TO hub_app;

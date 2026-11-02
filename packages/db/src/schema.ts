import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  jsonb,
  primaryKey,
  unique,
  type AnyPgColumn
} from "drizzle-orm/pg-core";

export interface ReservationPolicyConfig {
  CARD: number;
  BANK_INSTALLMENT: number;
  PAY_ON_PICKUP: number;
  CASH_ON_DELIVERY: number;
}

export const legalEntities = pgTable("legal_entities", {
  id: uuid("id").primaryKey(),
  key: text("key").notNull().unique(),
  legalName: text("legal_name").notNull(),
  taxId: text("tax_id").notNull().unique(),
  pricesIncludeVat: boolean("prices_include_vat").notNull(), // [C11]
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").unique(),
  fullName: text("full_name").notNull(),
  passwordHash: text("password_hash"),
  totpSecretEncrypted: text("totp_secret_encrypted"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  loginLockedUntil: timestamp("login_locked_until", { withTimezone: true }),
  pinHash: text("pin_hash"),
  failedPinAttempts: integer("failed_pin_attempts").notNull().default(0),
  pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
  role: text("role").notNull(), // 'ADMIN' | 'OPERATOR' | 'STOCK_MANAGER' | 'WAREHOUSE' | 'ORDER_MANAGER' [C12]
  locale: text("locale").notNull().default("ka"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const entityRelationships = pgTable("entity_relationships", {
  id: uuid("id").primaryKey(),
  fromEntityId: uuid("from_entity_id")
    .notNull()
    .references(() => legalEntities.id),
  toEntityId: uuid("to_entity_id")
    .notNull()
    .references(() => legalEntities.id),
  mode: text("mode").notNull(), // 'PURCHASE' | 'CONSIGNMENT' [C17]
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const storefronts = pgTable("storefronts", {
  id: uuid("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  sellerEntityId: uuid("seller_entity_id")
    .notNull()
    .references(() => legalEntities.id),
  mediaBaseUrl: text("media_base_url").notNull(),
  webhookUrl: text("webhook_url"),
  webhookSecretEncrypted: text("webhook_secret_encrypted"),
  reservationPolicyJson: jsonb("reservation_policy_json")
    .$type<ReservationPolicyConfig>()
    .notNull()
    .default({
      CARD: 1800,
      BANK_INSTALLMENT: 259200,
      PAY_ON_PICKUP: 259200,
      CASH_ON_DELIVERY: 259200
    }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const storefrontApiKeys = pgTable("storefront_api_keys", {
  id: uuid("id").primaryKey(),
  storefrontId: uuid("storefront_id")
    .notNull()
    .references(() => storefronts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  allowedIps: text("allowed_ips").array(),
  active: boolean("active").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
});

export const userEntityMemberships = pgTable(
  "user_entity_memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id, { onDelete: "cascade" }),
    isStockManagerRecipient: boolean("is_stock_manager_recipient").notNull().default(false),
    isReportRecipient: boolean("is_report_recipient").notNull().default(false)
  },
  (table) => [primaryKey({ columns: [table.userId, table.legalEntityId] })]
);

export const userPermissions = pgTable(
  "user_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.userId, table.permissionKey] })]
);

export const registeredDevices = pgTable("registered_devices", {
  id: uuid("id").primaryKey(),
  deviceName: text("device_name").notNull(),
  deviceTokenHash: text("device_token_hash").notNull().unique(),
  registeredBy: uuid("registered_by")
    .notNull()
    .references(() => users.id),
  active: boolean("active").notNull().default(true),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").references(() => registeredDevices.id, { onDelete: "cascade" }),
  authMethod: text("auth_method").notNull(), // 'OFFICE_PASSWORD_TOTP' | 'WAREHOUSE_PIN'
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  actorStorefrontId: uuid("actor_storefront_id").references(() => storefronts.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeJson: jsonb("before_json").$type<Record<string, unknown> | null>(),
  afterJson: jsonb("after_json").$type<Record<string, unknown> | null>(),
  reason: text("reason"),
  externalDocumentRef: text("external_document_ref"),
  correlationId: text("correlation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey(),
  eventType: text("event_type").notNull(),
  storefrontId: uuid("storefront_id").references(() => storefronts.id),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
  correlationId: text("correlation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const outboxDeliveries = pgTable(
  "outbox_deliveries",
  {
    id: uuid("id").primaryKey(),
    outboxEventId: uuid("outbox_event_id")
      .notNull()
      .references(() => outboxEvents.id, { onDelete: "cascade" }),
    consumer: text("consumer").notNull(), // 'storefront:<id>' | 'notifications' [C10]
    status: text("status").notNull(), // 'PENDING' | 'DELIVERED' | 'DEAD_LETTER'
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true })
  },
  (table) => [unique().on(table.outboxEventId, table.consumer)]
);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey(),
  outboxEventId: uuid("outbox_event_id")
    .notNull()
    .references(() => outboxEvents.id, { onDelete: "cascade" }),
  outboxDeliveryId: uuid("outbox_delivery_id").references(() => outboxDeliveries.id, {
    onDelete: "cascade"
  }),
  storefrontId: uuid("storefront_id")
    .notNull()
    .references(() => storefronts.id),
  responseStatus: integer("response_status"),
  responseBodyExcerpt: text("response_body_excerpt"),
  durationMs: integer("duration_ms"),
  succeeded: boolean("succeeded").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("IN_PROGRESS"), // 'IN_PROGRESS' | 'COMPLETED'
    responseStatus: integer("response_status"),
    responseBodyJson: jsonb("response_body_json").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
  },
  (table) => [primaryKey({ columns: [table.scope, table.idempotencyKey] })]
);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value_json").$type<Record<string, unknown>>().notNull(),
  description: text("description").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

// ============================================================================
// Milestone 2: Product Master, Taxonomy, Identifiers & Accounting Mappings
// ============================================================================

export interface ProductTypeAttributeFieldDef {
  key: string;
  labelKa: string;
  labelEn: string;
  dataType: "string" | "number" | "boolean" | "enum";
  tier: "REQUIRED_IDENTITY" | "IMPORTANT_SPEC" | "OPTIONAL_SPEC";
  filterCandidate: boolean;
  unit?: string;
  enumValues?: string[];
}

export interface ProductTypePhotoInstructionSlot {
  slot: "MAIN" | "SECONDARY" | "IDENTIFICATION";
  titleKa: string;
  titleEn: string;
  guidanceKa: string;
  guidanceEn: string;
  required: boolean;
}

export interface ProductTypeAiResearchContract {
  requiredIdentityFields: string[];
  targetSpecificationFields: string[];
  forbidInvention: boolean;
  unknownFieldPolicy: "NULL_NOT_FOUND";
}

export interface KitComponentInfo {
  nameKa: string;
  nameEn?: string;
  quantity: number;
  notes?: string;
}

export interface SkuAttributeValueEntry {
  value: string | number | boolean | null;
  status: "VERIFIED" | "UNVERIFIED" | "NOT_FOUND" | "CONFLICT";
  sourceType?: string;
  evidenceId?: string;
  verifiedBy?: string;
  verifiedAt?: string;
}

export interface SkuUnitMetadataEntry {
  sourceString: string | null;
  status: "VERIFIED" | "UNVERIFIED" | "NOT_FOUND" | "CONFLICT";
  sourceType?: string;
  evidenceId?: string;
  verifiedBy?: string;
  verifiedAt?: string;
}

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey(),
  key: text("key").notNull().unique(),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
  nameKa: text("name_ka").notNull(),
  nameEn: text("name_en").notNull(),
  isUnclassified: boolean("is_unclassified").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const productTypes = pgTable("product_types", {
  id: uuid("id").primaryKey(),
  key: text("key").notNull().unique(),
  defaultCategoryId: uuid("default_category_id")
    .notNull()
    .references(() => categories.id),
  nameKa: text("name_ka").notNull(),
  nameEn: text("name_en").notNull(),
  attributeSchemaJson: jsonb("attribute_schema_json")
    .$type<ProductTypeAttributeFieldDef[]>()
    .notNull(),
  photoInstructionsJson: jsonb("photo_instructions_json")
    .$type<ProductTypePhotoInstructionSlot[]>()
    .notNull(),
  namingTemplateKa: text("naming_template_ka").notNull(),
  namingTemplateEn: text("naming_template_en").notNull(),
  aiResearchContractJson: jsonb("ai_research_contract_json")
    .$type<ProductTypeAiResearchContract>()
    .notNull(),
  searchAliasesKa: text("search_aliases_ka").array().notNull().default([]),
  searchAliasesEn: text("search_aliases_en").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const productFamilies = pgTable("product_families", {
  id: uuid("id").primaryKey(),
  code: text("code").notNull().unique(),
  productTypeId: uuid("product_type_id").references(() => productTypes.id),
  categoryId: uuid("category_id").references(() => categories.id),
  brand: text("brand"),
  manufacturer: text("manufacturer"),
  baseModel: text("base_model"),
  titleKa: text("title_ka").notNull(),
  titleEn: text("title_en"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const skus = pgTable("skus", {
  id: uuid("id").primaryKey(),
  internalSku: text("internal_sku").notNull().unique(),
  productFamilyId: uuid("product_family_id").references(() => productFamilies.id),
  productTypeId: uuid("product_type_id").references(() => productTypes.id),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id),
  canonicalSlug: text("canonical_slug"), // [C8] NULL at INTAKE, required at READY
  lifecycleState: text("lifecycle_state").notNull().default("INTAKE"),
  identityConfidence: text("identity_confidence").notNull().default("LOW"),
  isComposedBundle: boolean("is_composed_bundle").notNull().default(false),
  isKit: boolean("is_kit").notNull().default(false),
  kitComponentsJson: jsonb("kit_components_json").$type<KitComponentInfo[] | null>(),
  brand: text("brand"),
  manufacturer: text("manufacturer"),
  modelCode: text("model_code"),
  keyDifferentiatorKa: text("key_differentiator_ka"),
  keyDifferentiatorEn: text("key_differentiator_en"),

  // Universal normalized units (§5.6)
  powerKw: numeric("power_kw", { precision: 10, scale: 3 }),
  engineDisplacementCm3: numeric("engine_displacement_cm3", { precision: 10, scale: 2 }),
  lengthMm: numeric("length_mm", { precision: 10, scale: 2 }),
  widthMm: numeric("width_mm", { precision: 10, scale: 2 }),
  heightMm: numeric("height_mm", { precision: 10, scale: 2 }),
  workingWidthMm: numeric("working_width_mm", { precision: 10, scale: 2 }),
  workingDepthMm: numeric("working_depth_mm", { precision: 10, scale: 2 }),
  weightKg: numeric("weight_kg", { precision: 10, scale: 3 }),
  volumeL: numeric("volume_l", { precision: 10, scale: 3 }),
  pressureBar: numeric("pressure_bar", { precision: 10, scale: 2 }),
  flowLMin: numeric("flow_l_min", { precision: 10, scale: 2 }),
  voltageV: numeric("voltage_v", { precision: 10, scale: 2 }),
  currentA: numeric("current_a", { precision: 10, scale: 2 }),
  unitSourceStringsJson: jsonb("unit_source_strings_json")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  unitMetadataJson: jsonb("unit_metadata_json")
    .$type<Record<string, SkuUnitMetadataEntry>>()
    .notNull()
    .default({}),

  // Schema-driven type attributes (§5.9)
  typeAttributesJson: jsonb("type_attributes_json")
    .$type<Record<string, SkuAttributeValueEntry>>()
    .notNull()
    .default({}),

  // Canonical content (§5.10, §5.12)
  displayNameKa: text("display_name_ka"),
  displayNameEn: text("display_name_en"),
  shortDescriptionKa: text("short_description_ka"),
  shortDescriptionEn: text("short_description_en"),
  fullDescriptionKa: text("full_description_ka"),
  fullDescriptionEn: text("full_description_en"),
  searchAliasesKa: text("search_aliases_ka").array().notNull().default([]),
  searchAliasesEn: text("search_aliases_en").array().notNull().default([]),

  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const skuSlugHistory = pgTable("sku_slug_history", {
  id: uuid("id").primaryKey(),
  skuId: uuid("sku_id")
    .notNull()
    .references(() => skus.id, { onDelete: "restrict" }),
  oldSlug: text("old_slug").notNull().unique(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
});

export const bundleComponents = pgTable(
  "bundle_components",
  {
    bundleSkuId: uuid("bundle_sku_id")
      .notNull()
      .references(() => skus.id, { onDelete: "cascade" }),
    componentSkuId: uuid("component_sku_id")
      .notNull()
      .references(() => skus.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull()
  },
  (table) => [primaryKey({ columns: [table.bundleSkuId, table.componentSkuId] })]
);

export const skuIdentifiers = pgTable(
  "sku_identifiers",
  {
    id: uuid("id").primaryKey(),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => skus.id, { onDelete: "cascade" }),
    identifierType: text("identifier_type").notNull(),
    value: text("value").notNull(),
    issuerSource: text("issuer_source"),
    verified: boolean("verified").notNull().default(false),
    isPrimary: boolean("is_primary").notNull().default(false),
    hasCollision: boolean("has_collision").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique().on(table.skuId, table.identifierType, table.value)]
);

export const accountingMappings = pgTable("accounting_mappings", {
  id: uuid("id").primaryKey(),
  skuId: uuid("sku_id")
    .notNull()
    .references(() => skus.id, { onDelete: "cascade" }),
  legalEntityId: uuid("legal_entity_id")
    .notNull()
    .references(() => legalEntities.id), // [C9]
  accountingItemId: text("accounting_item_id").notNull(),
  accountingName: text("accounting_name").notNull(),
  legacyCode: text("legacy_code"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const storefrontListings = pgTable(
  "storefront_listings",
  {
    id: uuid("id").primaryKey(),
    storefrontId: uuid("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => skus.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    enabledBy: uuid("enabled_by").references(() => users.id),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledBy: uuid("disabled_by").references(() => users.id),
    reason: text("reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique().on(table.storefrontId, table.skuId)]
);

export const legacyUrls = pgTable(
  "legacy_urls",
  {
    id: uuid("id").primaryKey(),
    oldHost: text("old_host").notNull(),
    oldPathRaw: text("old_path_raw").notNull(),
    oldPathNormalized: text("old_path_normalized").notNull(),
    entityType: text("entity_type").notNull(), // 'PRODUCT' | 'CATEGORY' | 'OTHER'
    entityId: uuid("entity_id"),
    decision: text("decision").notNull().default("UNDECIDED"), // 'KEEP_301' | 'ARCHIVE_PAGE' | 'GONE_410' | 'UNDECIDED'
    gscClicks16m: integer("gsc_clicks_16m"),
    gscImpressions16m: integer("gsc_impressions_16m"),
    backlinks: integer("backlinks"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique().on(table.oldHost, table.oldPathNormalized)]
);

// M3. SQL migrations additionally enforce checks and partial uniqueness.
export const scanTasks = pgTable("scan_tasks", {
  id: uuid("id").primaryKey(),
  taskType: text("task_type").notNull(),
  title: text("title").notNull(),
  assigneeUserId: uuid("assignee_user_id").references(() => users.id),
  assigneeRole: text("assignee_role"),
  productTypeId: uuid("product_type_id").references(() => productTypes.id),
  targetSkuId: uuid("target_sku_id").references(() => skus.id),
  poolId: uuid("pool_id"),
  fulfillmentRequestId: uuid("fulfillment_request_id"),
  photosRequired: boolean("photos_required").notNull().default(true),
  requestedPhotoSlotsJson: jsonb("requested_photo_slots_json").$type<string[] | null>(),
  photoRequestNote: text("photo_request_note"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  status: text("status").notNull().default("OPEN"),
  targetCount: integer("target_count"),
  completedCount: integer("completed_count").notNull().default(0),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true })
});

export const productIntakes = pgTable("product_intakes", {
  id: uuid("id").primaryKey(),
  taskId: uuid("task_id").references(() => scanTasks.id),
  sourceMode: text("source_mode").notNull(),
  scannedBy: uuid("scanned_by").notNull().references(() => users.id),
  deviceId: uuid("device_id").references(() => registeredDevices.id),
  clientDeviceId: uuid("client_device_id").notNull(),
  scannedIdentifiersJson: jsonb("scanned_identifiers_json").$type<string[]>().notNull().default([]),
  normalizedIdentifier: text("normalized_identifier"),
  isNoBarcode: boolean("is_no_barcode").notNull().default(false),
  matchedSkuId: uuid("matched_sku_id").references(() => skus.id),
  duplicateOfIntakeId: uuid("duplicate_of_intake_id").references((): AnyPgColumn => productIntakes.id),
  labelStatus: text("label_status").notNull().default("NOT_REQUIRED"),
  resultState: text("result_state").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  requestHash: text("request_hash").notNull(),
  scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull(),
  reviewReason: text("review_reason"),
  reviewOriginalReason: text("review_original_reason"),
  reviewReferenceSkuId: uuid("review_reference_sku_id").references(() => skus.id),
  scannedIdentifierType: text("scanned_identifier_type"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewResolution: text("review_resolution"),
  reviewNote: text("review_note"),
  replacementLabelRequested: boolean("replacement_label_requested").notNull().default(false),
  acceptanceResponseJson: jsonb("acceptance_response_json").$type<Record<string, unknown>>().notNull(),
  photosMissing: boolean("photos_missing").notNull().default(false),
  photoAttentionReason: text("photo_attention_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const intakeReviewActions = pgTable("intake_review_actions", {
  id: uuid("id").primaryKey(),
  intakeId: uuid("intake_id").notNull().references(() => productIntakes.id),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  requestHash: text("request_hash").notNull(),
  responseJson: jsonb("response_json").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const labelEvents = pgTable("label_events", {
  id: uuid("id").primaryKey(),
  intakeId: uuid("intake_id").notNull().references(() => productIntakes.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  scanIntakeId: uuid("scan_intake_id").references(() => productIntakes.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export interface MediaDerivative {
  key: string; sha256: string; bytes: number; width: number; format: "webp" | "avif";
  contentType: string; versionId?: string;
}
export const productImages = pgTable("product_images", {
  id: uuid("id").primaryKey(),
  skuId: uuid("sku_id").references(() => skus.id, { onDelete: "restrict" }),
  intakeId: uuid("intake_id").references(() => productIntakes.id, { onDelete: "restrict" }),
  photoRequestTaskId: uuid("photo_request_task_id").references(() => scanTasks.id, { onDelete: "restrict" }),
  slot: text("slot").notNull(), sourceType: text("source_type").notNull().default("WAREHOUSE"), sourceUrl: text("source_url"),
  role: text("role").notNull().default("IDENTITY"), status: text("status").notNull().default("UNVERIFIED"),
  usage: text("usage").notNull().default("INTERNAL_EVIDENCE"),
  rawStorageKey: text("raw_storage_key").notNull(), rawSha256: text("raw_sha256").notNull(),
  rawBytes: integer("raw_bytes").notNull(), rawVersionId: text("raw_version_id"), mimeType: text("mime_type").notNull(),
  width: integer("width").notNull(), height: integer("height").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(), deviceId: uuid("device_id").notNull(),
  registeredDeviceId: uuid("registered_device_id").references(() => registeredDevices.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull().unique(), requestHash: text("request_hash").notNull(), rejectReason: text("reject_reason"),
  masterStorageKey: text("master_storage_key"), masterSha256: text("master_sha256"),
  masterVersion: integer("master_version").notNull().default(0), requestedVersion: integer("requested_version").notNull().default(1),
  derivativesJson: jsonb("derivatives_json").$type<Record<string, MediaDerivative>>().notNull().default({}),
  tier1QualityJson: jsonb("tier1_quality_json").$type<Record<string, unknown>>().notNull(),
  tier2QualityJson: jsonb("tier2_quality_json").$type<Record<string, unknown> | null>(),
  perceptualHash: text("perceptual_hash"), processingStatus: text("processing_status").notNull().default("PENDING"),
  sortOrder: integer("sort_order").notNull().default(0), createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "restrict" }), verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
export const imageMasterVersions = pgTable("image_master_versions", {
  id: uuid("id").primaryKey(), imageId: uuid("image_id").notNull().references(() => productImages.id, { onDelete: "restrict" }),
  version: integer("version").notNull(), storageKey: text("storage_key").notNull().unique(), sha256: text("sha256").notNull(),
  bytes: integer("bytes").notNull(), width: integer("width").notNull(), height: integer("height").notNull(), storageVersionId: text("storage_version_id"),
  derivativesJson: jsonb("derivatives_json").$type<Record<string, MediaDerivative>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [unique().on(table.imageId, table.version)]);
export const intakePhotoStatus = pgTable("intake_photo_status", {
  intakeId: uuid("intake_id").primaryKey().references(() => productIntakes.id, { onDelete: "restrict" }),
  requiredSlotsJson: jsonb("required_slots_json").$type<string[]>().notNull(), status: text("status").notNull().default("PENDING"),
  coveredSlotsJson: jsonb("covered_slots_json").$type<string[]>().notNull().default([]),
  attentionReason: text("attention_reason"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
export const mediaJobs = pgTable("media_jobs", {
  id: uuid("id").primaryKey(), imageId: uuid("image_id").references(() => productImages.id, { onDelete: "restrict" }),
  skuId: uuid("sku_id").references(() => skus.id, { onDelete: "restrict" }), jobType: text("job_type").notNull(), imageVersion: integer("image_version"),
  dedupeKey: text("dedupe_key").notNull().unique(), status: text("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(3), lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
export const mediaActions = pgTable("media_actions", {
  id: uuid("id").primaryKey(), actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  action: text("action").notNull(), requestHash: text("request_hash").notNull(), responseJson: jsonb("response_json").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
export const imagePublications = pgTable("image_publications", {
  id: uuid("id").primaryKey(), imageId: uuid("image_id").notNull().references(() => productImages.id, { onDelete: "restrict" }),
  skuId: uuid("sku_id").notNull().references(() => skus.id, { onDelete: "restrict" }), masterVersion: integer("master_version").notNull(),
  objectKey: text("object_key").notNull(), width: integer("width").notNull(), format: text("format").notNull(), sha256: text("sha256").notNull(),
  status: text("status").notNull(), publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(), withdrawnAt: timestamp("withdrawn_at", { withTimezone: true })
});

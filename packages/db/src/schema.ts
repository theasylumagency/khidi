import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  bigint,
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
  totpEnrollmentRequired: boolean("totp_enrollment_required").notNull().default(false),
  totpEverEnabled: boolean("totp_ever_enabled").notNull().default(false),
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

export const userPasskeys = pgTable("user_passkeys", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  signCounter: bigint("sign_counter", { mode: "number" }).notNull(),
  transports: text("transports").array().notNull().default([]),
  backupEligible: boolean("backup_eligible").notNull(),
  backedUp: boolean("backed_up").notNull(),
  displayName: text("display_name").notNull(),
  registrationPlatform: text("registration_platform"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").references(() => registeredDevices.id, { onDelete: "cascade" }),
  authMethod: text("auth_method").notNull(), // 'OFFICE_PASSWORD_TOTP' | 'OFFICE_PASSKEY' | 'WAREHOUSE_PIN'
  lastStrongAuthAt: timestamp("last_strong_auth_at", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  passkeyId: uuid("passkey_id").references(() => userPasskeys.id, { onDelete: "restrict" }),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const webauthnChallenges = pgTable("webauthn_challenges", {
  id: uuid("id").primaryKey(),
  challengeHash: text("challenge_hash").notNull(),
  bindingHash: text("binding_hash").notNull(),
  ceremony: text("ceremony").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
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
  observable?: boolean;
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
  distinguishingAttributes: text("distinguishing_attributes").array().notNull().default([]),
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
  mergedIntoSkuId: uuid("merged_into_sku_id").references((): AnyPgColumn => skus.id, { onDelete: "restrict" }),
  mergedUndeterminedFields: text("merged_undetermined_fields").array().notNull().default([]),
  mergeConflictFields: text("merge_conflict_fields").array().notNull().default([]),
  splitBasisUnverified: boolean("split_basis_unverified").notNull().default(false),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id),
  canonicalSlug: text("canonical_slug"), // [C8] NULL at INTAKE, required at READY
  lifecycleState: text("lifecycle_state").notNull().default("INTAKE"),
  identityConfidence: text("identity_confidence").notNull().default("LOW"),
  identityKind: text("identity_kind").notNull().default("HOUSE_DEFINED"),
  identityRuleVersion: text("identity_rule_version").notNull().default("identity-rule-v1"),
  identityEvidenceIds: uuid("identity_evidence_ids").array().notNull().default([]),
  reverificationRequired: boolean("reverification_required").notNull().default(false),
  contentReviewRequired: boolean("content_review_required").notNull().default(false),
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
  redirectTargetType: text("redirect_target_type").notNull().default("SKU"),
  redirectCategoryId: uuid("redirect_category_id").references(() => categories.id),
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
  sharedItemConfirmedBy: uuid("shared_item_confirmed_by").references(() => users.id),
  sharedItemConfirmedAt: timestamp("shared_item_confirmed_at", { withTimezone: true }),
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
  scannedSkuId: uuid("scanned_sku_id").references(() => skus.id, { onDelete: "restrict" }),
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
export type EvidenceValue = string | number | boolean;
export type CanonicalContentOrigin = "MANUAL" | "DETERMINISTIC" | "AI_PROPOSAL";

export const skuContentVersions = pgTable("sku_content_versions", {
  id: uuid("id").primaryKey(),
  skuId: uuid("sku_id").notNull().references(() => skus.id, { onDelete: "restrict" }),
  locale: text("locale").notNull(),
  origin: text("origin").$type<CanonicalContentOrigin>().notNull(),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "restrict" }),
  aiJobId: uuid("ai_job_id").references((): AnyPgColumn => aiJobs.id, { onDelete: "restrict" }),
  imported: boolean("imported").notNull().default(false),
  displayName: text("display_name").notNull(),
  shortDescription: text("short_description").notNull(),
  fullDescription: text("full_description").notNull(),
  searchAliases: text("search_aliases").array().notNull().default([]),
  verifiedFacts: jsonb("verified_facts").$type<Record<string, EvidenceValue>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const skuContentApprovals = pgTable("sku_content_approvals", {
  skuId: uuid("sku_id").notNull().references(() => skus.id, { onDelete: "restrict" }),
  locale: text("locale").notNull(),
  versionId: uuid("version_id").notNull().references(() => skuContentVersions.id, { onDelete: "restrict" }),
  approvedBy: uuid("approved_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [primaryKey({ columns: [table.skuId, table.locale] })]);
export type EvidenceClaimSource =
  | { origin: "HUMAN"; userId?: string }
  | { origin: "AI"; jobId: string; confirmedBy?: string };

export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey(),
  skuId: uuid("sku_id").notNull().references(() => skus.id),
  supersedesEvidenceId: uuid("supersedes_evidence_id").references((): AnyPgColumn => evidence.id, { onDelete: "restrict" }),
  taskId: uuid("task_id").references(() => scanTasks.id),
  type: text("type").notNull(),
  sensitivity: text("sensitivity").notNull(),
  status: text("status").notNull().default("PENDING"),
  authorId: uuid("author_id").notNull().references(() => users.id),
  authorRole: text("author_role").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  imageId: uuid("image_id").references(() => productImages.id),
  privateStorageKey: text("private_storage_key"),
  privateSha256: text("private_sha256"),
  privateMimeType: text("private_mime_type"),
  supplierName: text("supplier_name"),
  documentNumber: text("document_number"),
  lineText: text("line_text"),
  quantity: integer("quantity"),
  measurementUnit: text("measurement_unit"),
  measurementMethod: text("measurement_method"),
  notes: text("notes"),
  comparisonSkuId: uuid("comparison_sku_id").references(() => skus.id),
  comparisonRelation: text("comparison_relation").notNull().default("DIFFERS"),
  acknowledgedUnknowns: jsonb("acknowledged_unknowns_json").$type<Record<string, string>>().notNull().default({}),
  intakeId: uuid("intake_id").references(() => productIntakes.id),
  supportingEvidenceIds: uuid("supporting_evidence_ids").array().notNull().default([]),
  comparisonSupportingEvidenceIds: uuid("comparison_supporting_evidence_ids").array().notNull().default([]),
  comparisonImageId: uuid("comparison_image_id").references(() => productImages.id, { onDelete: "restrict" }),
  comparisonClaims: jsonb("comparison_claims_json").$type<Record<string, EvidenceValue>>(),
  comparisonClaimSources: jsonb("comparison_claim_sources_json").$type<Record<string, EvidenceClaimSource>>(),
  claims: jsonb("claims_json").$type<Record<string, EvidenceValue>>().notNull().default({}),
  claimSources: jsonb("claim_sources_json").$type<Record<string, EvidenceClaimSource>>().notNull().default({}),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const skuFieldProvenance = pgTable("sku_field_provenance", {
  skuId: uuid("sku_id").notNull().references(() => skus.id),
  fieldName: text("field_name").notNull(),
  value: jsonb("value_json").$type<EvidenceValue>(),
  status: text("status").notNull(),
  evidenceIds: uuid("evidence_ids").array().notNull().default([]),
  confirmedEvidenceId: uuid("confirmed_evidence_id").references(() => evidence.id),
  notDeterminableReason: text("not_determinable_reason"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true })
}, (table) => [primaryKey({ columns: [table.skuId, table.fieldName] })]);

export const skuSplitTargets = pgTable("sku_split_targets", {
  sourceSkuId: uuid("source_sku_id").notNull().references(() => skus.id),
  targetSkuId: uuid("target_sku_id").notNull().references(() => skus.id),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [primaryKey({ columns: [table.sourceSkuId, table.targetSkuId] })]);

export const evidenceAttributions = pgTable("evidence_attributions", {
  evidenceId: uuid("evidence_id").notNull().references(() => evidence.id),
  sourceSkuId: uuid("source_sku_id").notNull().references(() => skus.id),
  targetSkuId: uuid("target_sku_id").notNull().references(() => skus.id),
  claimSkuId: uuid("claim_sku_id").notNull().references(() => skus.id),
  attributedBy: uuid("attributed_by").notNull().references(() => users.id),
  attributedAt: timestamp("attributed_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason").notNull()
}, (table) => [primaryKey({ columns: [table.evidenceId, table.claimSkuId, table.targetSkuId] })]);

export const imageAttributions = pgTable("image_attributions", {
  imageId: uuid("image_id").notNull().references(() => productImages.id),
  sourceSkuId: uuid("source_sku_id").notNull().references(() => skus.id),
  targetSkuId: uuid("target_sku_id").notNull().references(() => skus.id),
  attributedBy: uuid("attributed_by").notNull().references(() => users.id),
  attributedAt: timestamp("attributed_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason").notNull()
}, (table) => [primaryKey({ columns: [table.imageId, table.targetSkuId] })]);

export const skuMergeAcknowledgements = pgTable("sku_merge_acknowledgements", {
  id: uuid("id").primaryKey(),
  sourceSkuId: uuid("source_sku_id").notNull().references(() => skus.id),
  targetSkuId: uuid("target_sku_id").notNull().references(() => skus.id),
  evidenceId: uuid("evidence_id").notNull().references(() => evidence.id),
  fieldName: text("field_name").notNull(),
  reason: text("reason").notNull(),
  sourceUnknown: boolean("source_unknown").notNull(),
  targetUnknown: boolean("target_unknown").notNull(),
  expectedValue: jsonb("expected_value_json").$type<EvidenceValue>(),
  sourceLineageIds: uuid("source_lineage_ids").array().notNull(),
  targetLineageIds: uuid("target_lineage_ids").array().notNull(),
  acknowledgedBy: uuid("acknowledged_by").notNull().references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow()
});

export const skuSplitBasis = pgTable("sku_split_basis", {
  sourceSkuId: uuid("source_sku_id").notNull().references(() => skus.id),
  targetSkuId: uuid("target_sku_id").notNull().references(() => skus.id),
  fieldName: text("field_name").notNull(),
  value: jsonb("value_json").$type<EvidenceValue>().notNull(),
  evidenceId: uuid("evidence_id").notNull().references(() => evidence.id)
}, (table) => [primaryKey({ columns: [table.sourceSkuId,table.targetSkuId,table.fieldName] })]);

export const aiJobs = pgTable("ai_jobs", {
  id: uuid("id").primaryKey(),
  jobName: text("job_name").notNull(),
  skuId: uuid("sku_id").notNull().references(() => skus.id),
  evidenceId: uuid("evidence_id").references(() => evidence.id),
  imageId: uuid("image_id").references(() => productImages.id),
  imageVersion: integer("image_version"),
  dedupeKey: text("dedupe_key").notNull().unique(),
  generation: integer("generation").notNull().default(0),
  status: text("status").notNull().default("PENDING"),
  result: jsonb("result_json").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const aiJobLogs = pgTable("ai_job_logs", {
  id: uuid("id").primaryKey(),
  jobId: uuid("job_id").notNull().references(() => aiJobs.id),
  generation: integer("generation").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  budgetDay: text("budget_day").notNull(),
  reservedUsdMicros: bigint("reserved_usd_micros", { mode: "number" }).notNull(),
  costUsdMicros: bigint("cost_usd_micros", { mode: "number" }),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  status: text("status").notNull(),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true })
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
  generation: integer("generation").notNull().default(0),
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

export const storefrontPrices = pgTable("storefront_prices", {
  id: uuid("id").primaryKey(),
  skuId: uuid("sku_id").notNull().references(() => skus.id, { onDelete: "restrict" }),
  storefrontId: uuid("storefront_id").notNull().references(() => storefronts.id, { onDelete: "restrict" }),
  kind: text("kind").$type<"SET" | "WITHDRAWN">().notNull(),
  basePriceMinor: integer("base_price_minor"), currency: text("currency").notNull(),
  vatIncluded: boolean("vat_included").notNull(), setBy: uuid("set_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(), reason: text("reason"),
  batchId: uuid("batch_id"), source: text("source").$type<"MANUAL" | "BULK" | "CSV_IMPORT">().notNull()
});

export const stockPools = pgTable("stock_pools", {
  id: uuid("id").primaryKey(), ownerEntityId: uuid("owner_entity_id").notNull().references(() => legalEntities.id, { onDelete: "restrict" }),
  name: text("name").notNull(), locationNote: text("location_note"), active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
export const poolLocations = pgTable("pool_locations", {
  id: uuid("id").primaryKey(), poolId: uuid("pool_id").notNull().references(() => stockPools.id, { onDelete: "restrict" }),
  kind: text("kind").$type<"SHELF" | "STAGING">().notNull(), name: text("name").notNull()
}, (t) => [unique().on(t.poolId, t.kind)]);
export const allocations = pgTable("allocations", {
  id: uuid("id").primaryKey(), poolId: uuid("pool_id").notNull().references(() => stockPools.id, { onDelete: "restrict" }),
  storefrontId: uuid("storefront_id").notNull().references(() => storefronts.id, { onDelete: "restrict" }),
  skuId: uuid("sku_id").notNull().references(() => skus.id, { onDelete: "restrict" }), minimumStock: integer("minimum_stock").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [unique().on(t.poolId, t.storefrontId, t.skuId)]);
export const poolSkuBalances = pgTable("pool_sku_balances", {
  poolId: uuid("pool_id").notNull().references(() => stockPools.id, { onDelete: "restrict" }),
  skuId: uuid("sku_id").notNull().references(() => skus.id, { onDelete: "restrict" }),
  shelf: integer("shelf").notNull().default(0), staging: integer("staging").notNull().default(0), allocatedTotal: integer("allocated_total").notNull().default(0),
  unallocated: integer("unallocated").generatedAlwaysAs(sql` shelf + staging - allocated_total `),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [primaryKey({ columns: [t.poolId, t.skuId] })]);
export const allocationBalances = pgTable("allocation_balances", {
  allocationId: uuid("allocation_id").primaryKey().references(() => allocations.id, { onDelete: "restrict" }),
  allocated: integer("allocated").notNull().default(0), reserved: integer("reserved").notNull().default(0), committed: integer("committed").notNull().default(0),
  availableToSell: integer("available_to_sell").generatedAlwaysAs(sql` allocated - reserved - committed `),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
export const stockLedger = pgTable("stock_ledger", {
  id: uuid("id").primaryKey(), movementType: text("movement_type").notNull(), variant: text("variant").notNull().default("DEFAULT"), quantity: integer("quantity").notNull(),
  poolId: uuid("pool_id").notNull().references(() => stockPools.id, { onDelete: "restrict" }), skuId: uuid("sku_id").notNull().references(() => skus.id, { onDelete: "restrict" }),
  allocationId: uuid("allocation_id").references(() => allocations.id, { onDelete: "restrict" }), locationId: uuid("location_id").references(() => poolLocations.id, { onDelete: "restrict" }),
  shelfDelta: integer("shelf_delta").notNull(), stagingDelta: integer("staging_delta").notNull(), allocTotalDelta: integer("alloc_total_delta").notNull(),
  allocatedDelta: integer("allocated_delta").notNull(), reservedDelta: integer("reserved_delta").notNull(), committedDelta: integer("committed_delta").notNull(),
  ownerEntityId: uuid("owner_entity_id").notNull().references(() => legalEntities.id, { onDelete: "restrict" }),
  sellerEntityId: uuid("seller_entity_id").references(() => legalEntities.id, { onDelete: "restrict" }), storefrontId: uuid("storefront_id").references(() => storefronts.id, { onDelete: "restrict" }),
  relationshipMode: text("relationship_mode").$type<"PURCHASE" | "CONSIGNMENT">(), crossEntity: boolean("cross_entity").notNull(),
  documentRef: text("document_ref"), reason: text("reason"), actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  correlationId: text("correlation_id").notNull(), reservationId: uuid("reservation_id"), fulfillmentRequestId: uuid("fulfillment_request_id"), paymentMethod: text("payment_method"),
  countLineId: uuid("count_line_id"), scanConfirmed: boolean("scan_confirmed").notNull().default(false),
  sellerAccountingItemId: text("seller_accounting_item_id"), sellerAccountingName: text("seller_accounting_name"), ownerAccountingItemId: text("owner_accounting_item_id"), ownerAccountingName: text("owner_accounting_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  unique
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
    responseStatus: integer("response_status").notNull(),
    responseBodyJson: jsonb("response_body_json").$type<Record<string, unknown>>().notNull(),
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

import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const catalogReviewBatches = pgTable("catalog_review_batches", {
  id: uuid("id").primaryKey(),
  sourceSha256: text("source_sha256").notNull(),
  sources: jsonb("sources").$type<Record<string, string>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const catalogLegacyProducts = pgTable("catalog_legacy_products", {
  id: uuid("id").primaryKey(),
  batchId: uuid("batch_id").notNull(),
  wordpressId: integer("wordpress_id").notNull(),
  sourceStatus: text("source_status").$type<"PUBLISHED" | "DRAFT">().notNull(),
  baseline: jsonb("baseline").$type<Record<string, unknown>>().notNull(),
  reviewSource: jsonb("review_source").$type<Record<string, unknown>>().notNull()
});

export const catalogReviewAssignments = pgTable("catalog_review_assignments", {
  batchId: uuid("batch_id").notNull(),
  userId: uuid("user_id").notNull()
});

export const catalogReviewPhotos = pgTable("catalog_review_photos", {
  id: uuid("id").primaryKey(),
  batchId: uuid("batch_id").notNull(),
  assetKey: text("asset_key").notNull(),
  sourceUrl: text("source_url").notNull(),
  audit: jsonb("audit").$type<Record<string, string>>().notNull(),
  rawKey: text("raw_key").notNull(),
  rawSha256: text("raw_sha256").notNull(),
  rawVersion: text("raw_version"),
  previewKey: text("preview_key").notNull(),
  previewSha256: text("preview_sha256").notNull(),
  previewVersion: text("preview_version")
});

export const catalogReviewPhotoLinks = pgTable("catalog_review_photo_links", {
  batchId: uuid("batch_id").notNull(),
  productId: uuid("product_id").notNull(),
  photoId: uuid("photo_id").notNull(),
  position: integer("position").notNull()
});

export const catalogReviewProposals = pgTable("catalog_review_proposals", {
  id: uuid("id").primaryKey(),
  productId: uuid("product_id").notNull(),
  field: text("field").$type<"NAME" | "SHORT" | "FULL" | "PHOTO">().notNull(),
  original: text("original"),
  proposed: text("proposed"),
  observation: text("observation").notNull(),
  rationale: text("rationale").notNull(),
  proposedPhotoId: uuid("proposed_photo_id")
});

export const catalogReviewDecisions = pgTable("catalog_review_decisions", {
  id: uuid("id").primaryKey(),
  proposalId: uuid("proposal_id").notNull(),
  productId: uuid("product_id").notNull(),
  field: text("field").$type<"NAME" | "SHORT" | "FULL" | "PHOTO">().notNull(),
  revision: integer("revision").notNull(),
  actorId: uuid("actor_id").notNull(),
  action: text("action").$type<"APPROVE" | "REJECT" | "EDIT" | "DEFER">().notNull(),
  editedText: text("edited_text"),
  selectedPhotoId: uuid("selected_photo_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

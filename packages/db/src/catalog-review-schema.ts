import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const catalogFeedbackCards = pgTable("catalog_feedback_round_cards", {
  round: integer("round_no").notNull(), position: integer("position").notNull(), wp: integer("wordpress_id").notNull(),
  definition: jsonb("definition").notNull(), schemaVersion: integer("schema_version").notNull().default(2)
});
export const catalogFeedbackCardRevisions = pgTable("catalog_feedback_round_card_revisions", {
  round: integer("round_no").notNull(), position: integer("position").notNull(), revision: integer("revision").notNull(),
  definition: jsonb("definition").notNull(), note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone:true }).defaultNow().notNull()
});
export const catalogFeedbackSurveys = pgTable("catalog_feedback_round_surveys", {
  round: integer("round_no").primaryKey(), batchId: uuid("batch_id").notNull(), actor: uuid("actor_id").notNull(),
  answers: jsonb("answers").$type<string[]>().notNull(), createdAt: timestamp("created_at", { withTimezone:true }).defaultNow().notNull()
});
export const catalogFeedbackDecisions = pgTable("catalog_feedback_round_decisions", {
  round: integer("round_no").primaryKey(), actor: uuid("actor_id").notNull(), choice:text("choice").notNull(), note:text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone:true }).defaultNow().notNull()
});

export const catalogFeedbackEntries = pgTable("catalog_feedback_entries", {
  id: uuid("id").primaryKey(), productId: uuid("product_id").notNull(), actorId: uuid("actor_id").notNull(),
  revision: integer("revision").notNull(), submitted: boolean("submitted").notNull(),
  response: jsonb("response").notNull(), card: jsonb("card").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

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
  recommendedOrder: integer("recommended_order"),
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
  proposedPhotoId: uuid("proposed_photo_id"),
  origin: text("origin").$type<"IMPORT" | "MANUAL">().default("IMPORT").notNull(),
  createdBy: uuid("created_by")
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
  approvedText: text("approved_text"),
  approvedTextEditId: uuid("approved_text_edit_id"),
  selectedPhotoId: uuid("selected_photo_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export type CatalogReviewCheckpointProduct = {
  photoWork?: { uploads: number; requests: number; accepted: number };
  wordpressId: number;
  name: string | null;
  outcomes: {
    field: "NAME" | "SHORT" | "FULL" | "PHOTO";
    action: "APPROVE" | "REJECT" | "EDIT" | "DEFER";
    note: string | null;
    editedText: string | null;
    approvedText?: string | null;
    photoPosition: number | null;
  }[];
};

export const catalogReviewCheckpoints = pgTable("catalog_review_checkpoints", {
  id: uuid("id").primaryKey(),
  batchId: uuid("batch_id").notNull(),
  reviewerId: uuid("reviewer_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  report: jsonb("report").$type<CatalogReviewCheckpointProduct[]>().notNull()
});

export type ReviewPlacement = { x: number; y: number; size: number };
export const reviewPhotoModes = ["INSET","MOUNT","ADJUST","CLEAN","BACKGROUND","SCENE"] as const;
export type ReviewPhotoMode = typeof reviewPhotoModes[number];
export const reviewImageModels = ["local","gemini-3.1-flash-image","gemini-3-pro-image","gpt-image-2.6-sunburst","gpt-image-2.6-flare"] as const;
export type ReviewImageModel = typeof reviewImageModels[number];
/** Deterministic edit of a gallery photo: quarter turns, automatic tone, trimming of plain borders. */
export type ReviewAdjustment = { rotate: 0 | 90 | 180 | 270; tone: boolean; trim: boolean };

export const catalogReviewPhotoWork = pgTable("catalog_review_photo_work", {
  id: uuid("id").primaryKey(),
  batchId: uuid("batch_id").notNull(),
  productId: uuid("product_id").notNull(),
  actorId: uuid("actor_id").notNull(),
  kind: text("kind").$type<"UPLOAD" | "REQUEST" | "RENDER" | "PREVIEW" | "ACCEPT" | "FAILED" | "REJECT">().notNull(),
  parentId: uuid("parent_id"),
  basePhotoId: uuid("base_photo_id"),
  photoId: uuid("photo_id"),
  detail: text("detail"),
  mode: text("mode").$type<ReviewPhotoMode>(),
  model: text("model").$type<ReviewImageModel>(),
  placement: jsonb("placement").$type<ReviewPlacement>(),
  settings: jsonb("settings").$type<ReviewAdjustment>(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

import { and, asc, desc, eq, exists, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import {
  catalogLegacyProducts as products, catalogReviewAssignments as assignments,
  catalogReviewDecisions as decisions, catalogReviewPhotoLinks as links,
  catalogReviewPhotos as photos, catalogReviewProposals as proposals, users,
  type AppDatabase, type DbExecutor
} from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError, createUuidV7 } from "@khidi/shared";

export const reviewRoles = ["ADMIN", "CATALOG_REVIEWER"] as const;
export const reviewId = z.string().uuid();
export const decisionInput = z.object({
  proposalId: reviewId,
  revision: z.number().int().min(0),
  action: z.enum(["APPROVE", "REJECT", "EDIT", "DEFER"]),
  editedText: z.string().trim().min(1).max(20000).optional(),
  photoId: reviewId.optional(),
  note: z.string().trim().max(2000).optional()
}).strict();
export type DecisionInput = z.infer<typeof decisionInput>;

function checkReviewer(principal: AuthenticatedPrincipal) {
  if (!reviewRoles.some((role) => role === principal.role) || principal.authMethod === "WAREHOUSE_PIN") {
    throw new AppError("FORBIDDEN", "Catalog review access required.");
  }
}

function assigned(db: DbExecutor, principal: AuthenticatedPrincipal) {
  checkReviewer(principal);
  return principal.role === "ADMIN" ? undefined : exists(db.select({ userId: assignments.userId })
    .from(assignments).where(and(eq(assignments.batchId, products.batchId), eq(assignments.userId, principal.userId))));
}

function inPilot(db: DbExecutor) {
  return exists(db.select({ id: proposals.id }).from(proposals).where(eq(proposals.productId, products.id)));
}

export type ReviewProductSummary = {
  id: string;
  wordpressId: number;
  sourceStatus: "DRAFT" | "PUBLISHED";
  name: string | null;
  category: string | null;
  total: number;
  pending: number;
  deferred: number;
};

export async function listReviewProducts(db: AppDatabase, principal: AuthenticatedPrincipal): Promise<ReviewProductSummary[]> {
  const rows = await db.select({
    id: products.id, wordpressId: products.wordpressId, sourceStatus: products.sourceStatus,
    name: sql<string | null>`${products.baseline}->>'არსებული სახელი'`,
    category: sql<string | null>`${products.baseline}->>'კატეგორია (სამუშაო)'`,
    action: sql<DecisionInput["action"] | null>`(
      SELECT action FROM catalog_review_decisions WHERE proposal_id = ${proposals.id} ORDER BY revision DESC LIMIT 1
    )`
  }).from(products).innerJoin(proposals, eq(proposals.productId, products.id))
    .where(assigned(db, principal)).orderBy(asc(products.wordpressId), asc(proposals.field));

  const result = new Map<string, ReviewProductSummary>();
  for (const row of rows) {
    const item = result.get(row.id) ?? { id: row.id, wordpressId: row.wordpressId,
      sourceStatus: row.sourceStatus, name: row.name, category: row.category,
      total: 0, pending: 0, deferred: 0 };
    item.total++;
    if (!row.action) item.pending++;
    if (row.action === "DEFER") item.deferred++;
    result.set(row.id, item);
  }
  return [...result.values()];
}

export async function getReviewProduct(db: AppDatabase, principal: AuthenticatedPrincipal, productId: string) {
  const [product] = await db.select().from(products).where(and(
    eq(products.id, productId), assigned(db, principal), inPilot(db)
  ));
  if (!product) throw new AppError("NOT_FOUND", "Catalog review product unavailable.");

  const [options, history, photoOptions] = await Promise.all([
    db.select().from(proposals).where(eq(proposals.productId, product.id)),
    db.select({
      id: decisions.id, proposalId: decisions.proposalId, action: decisions.action,
      note: decisions.note, editedText: decisions.editedText, photoId: decisions.selectedPhotoId,
      revision: decisions.revision, createdAt: decisions.createdAt, actor: users.fullName
    }).from(decisions).innerJoin(users, eq(decisions.actorId, users.id))
      .where(eq(decisions.productId, product.id)).orderBy(desc(decisions.revision)),
    db.select({ id: links.photoId, position: links.position, audit: photos.audit })
      .from(links).innerJoin(photos, eq(links.photoId, photos.id))
      .where(eq(links.productId, product.id)).orderBy(asc(links.position))
  ]);
  return { product, proposals: options, history, photos: photoOptions };
}

export async function getReviewPhoto(db: AppDatabase, principal: AuthenticatedPrincipal, productId: string, photoId: string) {
  const [photo] = await db.select({
    key: photos.previewKey, sha256: photos.previewSha256, version: photos.previewVersion
  }).from(links).innerJoin(products, eq(products.id, links.productId))
    .innerJoin(photos, and(eq(photos.id, links.photoId), eq(photos.batchId, products.batchId)))
    .where(and(eq(links.productId, productId), eq(links.photoId, photoId), assigned(db, principal), inPilot(db)));
  if (!photo) throw new AppError("NOT_FOUND", "Catalog review photo unavailable.");
  return photo;
}

async function findProposal(db: DbExecutor, principal: AuthenticatedPrincipal, proposalId: string) {
  const [proposal] = await db.select({ proposal: proposals }).from(proposals)
    .innerJoin(products, eq(products.id, proposals.productId))
    .where(and(eq(proposals.id, proposalId), assigned(db, principal)));
  if (!proposal) throw new AppError("NOT_FOUND", "Catalog review proposal unavailable.");
  return proposal.proposal;
}

export async function recordReviewDecision(db: AppDatabase, principal: AuthenticatedPrincipal, key: string, input: DecisionInput) {
  await findProposal(db, principal, input.proposalId);
  return executeIdempotent(db, { scope: `catalog-review:${principal.userId}`, idempotencyKey: key, payload: input },
    (tx) => withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
      // The runtime has no UPDATE grant on proposals. Serialize by proposal without locking its row for update.
      await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.proposalId}, 0))`);
      const proposal = await findProposal(ctx.tx, principal, input.proposalId);
      const [last] = await ctx.tx.select({ revision: decisions.revision }).from(decisions)
        .where(eq(decisions.proposalId, proposal.id)).orderBy(desc(decisions.revision)).limit(1);
      if ((last?.revision ?? 0) !== input.revision) throw new AppError("CONFLICT", "The review has changed.");

      const isPhoto = proposal.field === "PHOTO";
      const selectedPhotoId = isPhoto && input.action === "APPROVE" ? input.photoId ?? proposal.proposedPhotoId : null;
      if ((input.action === "EDIT") !== Boolean(input.editedText) || (isPhoto && input.action === "EDIT")
        || (input.photoId && (!isPhoto || input.action !== "APPROVE"))
        || (isPhoto && input.action === "APPROVE" && !selectedPhotoId)) {
        throw new AppError("VALIDATION_ERROR", "Decision does not match the proposal.");
      }
      if (selectedPhotoId) {
        const [linked] = await ctx.tx.select({ id: links.photoId }).from(links)
          .where(and(eq(links.productId, proposal.productId), eq(links.photoId, selectedPhotoId)));
        if (!linked) throw new AppError("VALIDATION_ERROR", "Photo is not available for this product.");
      }

      const id = createUuidV7();
      const revision = input.revision + 1;
      await ctx.tx.insert(decisions).values({
        id, proposalId: proposal.id, productId: proposal.productId, field: proposal.field, revision, actorId: principal.userId,
        action: input.action, editedText: input.editedText, selectedPhotoId, note: input.note || null
      });
      const summary = { proposalId: proposal.id, field: proposal.field, action: input.action, revision };
      await ctx.recordAudit({ action: "CATALOG_REVIEW_DECIDED", entityType: "catalog_review_decision", entityId: id, after: summary });
      await ctx.emitOutboxEvent({
        eventType: "CATALOG_REVIEW_DECIDED", aggregateType: "catalog_review_proposal",
        aggregateId: proposal.id, payload: summary, consumers: []
      });
      return { status: 200, body: { id, revision } };
    })
  );
}

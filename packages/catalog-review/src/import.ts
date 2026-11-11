import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  assertSeedDatabaseSafety, catalogLegacyProducts, catalogReviewAssignments, catalogReviewBatches,
  catalogReviewPhotoLinks, catalogReviewPhotos, catalogReviewProposals, users, type AppDatabase
} from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { storeLegacyReviewPhoto } from "@khidi/media";
import { digest, type MediaStorage } from "@khidi/media/storage";
import { createUuidV7 } from "@khidi/shared";

const checksum = z.string().regex(/^[a-f0-9]{64}$/);
const assetKey = z.string().regex(/^[a-f0-9]{16}$/);
const auditRow = z.record(z.string());
const proposal = z.object({
  field: z.enum(["NAME", "SHORT", "FULL", "PHOTO"]),
  original: z.string().nullable(),
  proposed: z.string().nullable(),
  observation: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  proposedPhotoKey: assetKey.nullable()
});
const product = z.object({
  wordpressId: z.number().int().positive(),
  recommendedOrder: z.number().int().min(1).max(20).nullable().optional(),
  status: z.enum(["PUBLISHED", "DRAFT"]),
  baseline: z.record(z.unknown()),
  reviewSource: z.record(z.unknown()),
  productAudit: auditRow,
  queue: auditRow.nullable(),
  photos: z.array(z.object({ position: z.number().int().positive(), audit: auditRow })),
  proposals: z.array(proposal).max(4)
});
const bundleSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  sources: z.record(checksum),
  products: z.array(product).length(248)
});

export function assertLocalReviewDatabase(env: NodeJS.ProcessEnv = process.env) {
  assertSeedDatabaseSafety(env);
  const app = new URL(env.DATABASE_URL!);
  const migrator = new URL(env.DATABASE_MIGRATOR_URL!);
  if (app.hostname !== "127.0.0.1" || migrator.hostname !== "127.0.0.1"
    || app.host !== migrator.host || app.pathname !== migrator.pathname
    || app.search || migrator.search || (env.MEDIA_STORAGE_DRIVER ?? "filesystem") !== "filesystem") {
    throw new Error("Catalog pilot requires the same explicit loopback development database and local media.");
  }
}

async function readAuditedPhoto(root: string, audit: Record<string, string>) {
  const relative = audit.output_relative_path;
  const key = assetKey.parse(audit.asset_key);
  const source = new URL(audit.original_url ?? "");
  if (source.origin !== "https://agro-trade.ge" || source.username || source.password
    || !source.pathname.startsWith("/wp-content/uploads/")) throw new Error(`Photo is outside the WordPress archive: ${key}`);
  if (!relative?.startsWith(`originals/${key}_`) || !/^originals\/[^/\\]+$/u.test(relative) || audit.status !== "OK") {
    throw new Error(`Unusable audit entry for ${key}`);
  }
  const file = await realpath(path.join(root, relative));
  const location = path.relative(root, file);
  if (location.startsWith(".." + path.sep) || path.isAbsolute(location) || !location.startsWith("originals" + path.sep)) {
    throw new Error("Photo escapes the original media directory.");
  }
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size !== Number(audit.bytes) || metadata.size > 15 * 1024 * 1024) {
    throw new Error(`Photo size differs from the audit: ${key}`);
  }
  const raw = await readFile(file);
  if (digest(raw) !== checksum.parse(audit.sha256)) throw new Error(`Photo hash differs from the audit: ${key}`);
  return raw;
}

export async function importReviewPilot(
  db: AppDatabase, storage: MediaStorage, manifestBytes: Uint8Array, mediaDirectory: string,
  adminEmail: string, reviewerEmail?: string
) {
  const manifest = bundleSchema.parse(JSON.parse(Buffer.from(manifestBytes).toString("utf8")));
  const sourceSha256 = digest(manifestBytes);
  const ids = new Set(manifest.products.map((item) => item.wordpressId));
  const reviewable = manifest.products.filter((item) => item.proposals.length > 0);
  const recommended = manifest.products.flatMap((item) => item.recommendedOrder ?? []);
  if (ids.size !== 248 || manifest.products.filter((item) => item.status === "DRAFT").length !== 31
    || (manifest.version === 2 && (reviewable.length !== 248 || recommended.length !== 20 || new Set(recommended).size !== 20))) {
    throw new Error("The full catalog requires 248 unique reviewable rows, 31 source drafts and 20 recommended products.");
  }
  const root = await realpath(mediaDirectory);
  const [admin] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.email, adminEmail), eq(users.role, "ADMIN"), eq(users.active, true)));
  if (!admin) throw new Error("An active local admin is required for import attribution.");
  const reviewer = reviewerEmail ? (await db.select({ id: users.id }).from(users)
    .where(and(eq(users.email, reviewerEmail), eq(users.role, "CATALOG_REVIEWER"), eq(users.active, true))))[0] : undefined;
  if (reviewerEmail && !reviewer) throw new Error("The named local reviewer account is unavailable.");

  return withDomainTransaction(db, { userId: admin.id }, async (ctx) => {
    await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${sourceSha256}, 0))`);
    const [existing] = await ctx.tx.select({ id: catalogReviewBatches.id }).from(catalogReviewBatches)
      .where(eq(catalogReviewBatches.sourceSha256, sourceSha256));
    const id = existing?.id ?? createUuidV7();

    if (!existing) {
      if (manifest.version !== 2) throw new Error("Prepare a version 2 manifest for a new full-catalog import.");
      const sources = new Map<string, Record<string, string>>();
      for (const item of reviewable) {
        for (const { audit } of item.photos) {
          const key = assetKey.parse(audit.asset_key);
          const previous = sources.get(key);
          if (previous && JSON.stringify(previous) !== JSON.stringify(audit)) throw new Error(`Conflicting audit for ${key}`);
          sources.set(key, audit);
        }
      }
      const originals = new Map<string, Uint8Array>();
      for (const [key, audit] of sources) originals.set(key, await readAuditedPhoto(root, audit));
      await ctx.tx.insert(catalogReviewBatches).values({ id, sourceSha256, sources: manifest.sources });
      const productIds = new Map(manifest.products.map((item) => [item.wordpressId, createUuidV7()]));
      await ctx.tx.insert(catalogLegacyProducts).values(manifest.products.map((item) => ({
        id: productIds.get(item.wordpressId)!, batchId: id, wordpressId: item.wordpressId,
        sourceStatus: item.status, baseline: item.baseline, recommendedOrder: item.recommendedOrder ?? null,
        reviewSource: {
          workbook: item.reviewSource, productAudit: item.productAudit, photoQueue: item.queue,
          photoReferences: item.photos.map(({ position, audit }) => ({ position, assetKey: audit.asset_key }))
        }
      })));

      const photoIds = new Map<string, string>();
      for (const [key, audit] of sources) {
        const photoId = createUuidV7();
        const { raw, preview } = await storeLegacyReviewPhoto(storage, photoId, originals.get(key)!);
        await ctx.tx.insert(catalogReviewPhotos).values({
          id: photoId, batchId: id, assetKey: key, sourceUrl: audit.original_url!, audit,
          rawKey: raw.key, rawSha256: raw.sha256, rawVersion: raw.versionId,
          previewKey: preview.key, previewSha256: preview.sha256, previewVersion: preview.versionId
        });
        photoIds.set(key, photoId);
      }
      for (const item of reviewable) {
        const productId = productIds.get(item.wordpressId)!;
        // WordPress can list the same asset at more than one position. The snapshot keeps every
        // reference; the reviewer sees each asset once, in its first source position.
        const unique = new Map<string, number>();
        for (const { position, audit } of item.photos) {
          const photoId = photoIds.get(audit.asset_key!)!;
          if (!unique.has(photoId)) unique.set(photoId, position);
        }
        if (unique.size) await ctx.tx.insert(catalogReviewPhotoLinks).values(
          [...unique].map(([photoId, position]) => ({ batchId: id, productId, photoId, position }))
        );
        await ctx.tx.insert(catalogReviewProposals).values(item.proposals.map(({ proposedPhotoKey, ...fields }) => ({
          ...fields, id: createUuidV7(), productId,
          proposedPhotoId: proposedPhotoKey ? photoIds.get(proposedPhotoKey)! : null
        })));
      }
      const payload = { staged: manifest.products.length, reviewable: reviewable.length, recommended: recommended.length, photos: photoIds.size, sourceSha256 };
      await ctx.recordAudit({ action: "CATALOG_REVIEW_IMPORTED", entityType: "catalog_review_batch", entityId: id, after: payload });
      await ctx.emitOutboxEvent({ eventType: "CATALOG_REVIEW_IMPORTED", aggregateType: "catalog_review_batch", aggregateId: id, payload, consumers: [] });
    }
    if (reviewer) {
      const [added] = await ctx.tx.insert(catalogReviewAssignments).values({ batchId: id, userId: reviewer.id }).onConflictDoNothing().returning();
      if (added) {
        const payload = { userId: reviewer.id };
        await ctx.recordAudit({ action: "CATALOG_REVIEW_ASSIGNED", entityType: "catalog_review_batch", entityId: id, after: payload });
        await ctx.emitOutboxEvent({ eventType: "CATALOG_REVIEW_ASSIGNED", aggregateType: "catalog_review_batch", aggregateId: id, payload, consumers: [] });
      }
    }
    return { batchId: id, staged: manifest.products.length, reviewable: reviewable.length, recommended: recommended.length, replayed: Boolean(existing) };
  });
}

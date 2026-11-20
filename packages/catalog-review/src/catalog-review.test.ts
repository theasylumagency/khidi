import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemMediaStorage } from "@khidi/media/storage";
import { acceptReviewDraft, rejectReviewDraft, renderReviewDraft, requestReviewEdit, uploadReviewImage } from "./photo-work.ts";
import { and, eq, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import {
  auditLogs, catalogLegacyProducts, catalogReviewAssignments, catalogReviewBatches, catalogReviewDecisions,
  catalogReviewPhotoLinks, catalogReviewPhotos, catalogReviewProposals, closeAppPool, connectMigratorDatabase,
  getDb, outboxEvents, users
} from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import { getReviewPhoto, getReviewProduct, listReviewProducts, recordReviewDecision } from "./index.ts";
import { assertLocalReviewDatabase } from "./import.ts";

const uuid = createUuidV7;
const hash = "a".repeat(64);
afterAll(closeAppPool);

describe("catalog review", () => {
  it("isolates assignments, records all four actions and preserves source, media and Product Master", async () => {
    const db = getDb();
    const migrator = connectMigratorDatabase();
    const reviewerId = uuid();
    const otherId = uuid();
    const batchId = uuid();
    const productId = uuid();
    const excludedId = uuid();
    const photoId = uuid();
    const nameProposal = uuid();
    const photoProposal = uuid();
    try {
      await migrator.db.transaction(async (tx) => {
        await tx.insert(users).values([reviewerId, otherId].map((id) => ({
          id, email: `${id}@example.test`, fullName: "Review test", role: "CATALOG_REVIEWER"
        })));
        await tx.insert(catalogReviewBatches).values({ id: batchId, sourceSha256: batchId.replaceAll("-", "").repeat(2), sources: {} });
        await tx.insert(catalogReviewAssignments).values({ batchId, userId: reviewerId });
        await tx.insert(catalogLegacyProducts).values([
          { id: productId, batchId, wordpressId: 10, sourceStatus: "PUBLISHED", baseline: { "არსებული სახელი": "Source" }, reviewSource: {} },
          { id: excludedId, batchId, wordpressId: 11, sourceStatus: "DRAFT", baseline: {}, reviewSource: {} }
        ]);
        await tx.insert(catalogReviewPhotos).values({
          id: photoId, batchId, assetKey: "test", sourceUrl: "https://example.test/source.jpg",
          audit: { quality_flags: "LOW_RESOLUTION_REVIEW" },
          rawKey: "raw/test", rawSha256: hash, previewKey: "master/test", previewSha256: hash
        });
        await tx.insert(catalogReviewPhotoLinks).values({ batchId, productId, photoId, position: 1 });
        await tx.insert(catalogReviewProposals).values([
          { id: nameProposal, productId, field: "NAME", original: "Source", proposed: "v2", observation: "Observed", rationale: "Rationale" },
          { id: photoProposal, productId, field: "PHOTO", observation: "Quality flag", rationale: "Choose an alternative" }
        ]);
      });
    } finally {
      await migrator.close();
    }
    const principal: AuthenticatedPrincipal = {
      userId: reviewerId, role: "CATALOG_REVIEWER", email: null, fullName: "Review test", locale: "ka",
      entityIds: [], permissions: [], authMethod: "OFFICE_PASSWORD_TOTP", deviceId: null
    };
    const unassigned = { ...principal, userId: otherId };
    const before = await db.execute(sql`SELECT count(*) AS total, md5(string_agg(id::text || ':' || lifecycle_state, ',' ORDER BY id)) AS states FROM skus`);
    expect(await listReviewProducts(db, principal)).toMatchObject([{ id: productId, name: "Source", pending: 2 }]);
    expect(await listReviewProducts(db, unassigned)).toEqual([]);
    await expect(listReviewProducts(db, { ...principal, role: "OPERATOR" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getReviewProduct(db, principal, excludedId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getReviewProduct(db, unassigned, productId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getReviewPhoto(db, principal, excludedId, photoId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getReviewPhoto(db, unassigned, productId, photoId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getReviewPhoto(db, principal, productId, photoId)).toMatchObject({ key: "master/test", sha256: hash });
    await expect(recordReviewDecision(db, unassigned, uuid(), {
      proposalId: nameProposal, revision: 0, action: "APPROVE"
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const approve = { proposalId: nameProposal, revision: 0, action: "APPROVE", textVersion: "PROPOSAL" } as const;
    const key = uuid();
    const accepted = await recordReviewDecision(db, principal, key, approve);
    expect(await recordReviewDecision(db, principal, key, approve)).toMatchObject({ replayed: true, body: accepted.body });
    await expect(recordReviewDecision(db, principal, key, { ...approve, action: "REJECT" })).rejects
      .toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const race = await Promise.allSettled([
      recordReviewDecision(db, principal, uuid(), { proposalId: nameProposal, revision: 1, action: "REJECT", note: "Reason" }),
      recordReviewDecision(db, principal, uuid(), { proposalId: nameProposal, revision: 1, action: "DEFER" })
    ]);
    expect(race.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(race.find((item) => item.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    const missingAction = race[0]?.status === "fulfilled" ? "DEFER" : "REJECT";
    await recordReviewDecision(db, principal, uuid(), { proposalId: nameProposal, revision: 2, action: missingAction, note: "Reason" });
    await recordReviewDecision(db, principal, uuid(), { proposalId: nameProposal, revision: 3, action: "EDIT", editedText: "Reviewer text" });

    await expect(recordReviewDecision(db, principal, uuid(), { proposalId: photoProposal, revision: 0, action: "APPROVE", photoId: uuid() }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await recordReviewDecision(db, principal, uuid(), { proposalId: photoProposal, revision: 0, action: "APPROVE", photoId });

    const detail = await getReviewProduct(db, principal, productId);
    expect(detail.history.filter((entry) => entry.proposalId === nameProposal).map((entry) => entry.action).sort())
      .toEqual(["APPROVE", "DEFER", "EDIT", "REJECT"]);
    expect(detail.history).toHaveLength(5);
    expect(detail.proposals.find((entry) => entry.id === nameProposal)).toMatchObject({ original: "Source", proposed: "v2" });
    const directory = await mkdtemp(join(tmpdir(), "review-photo-test-"));
    try {
      const storage = new FilesystemMediaStorage(directory);
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwnwGM/zMwAAAf7gP9qS/A4gAAAABJRU5ErkJggg==", "base64");
      const uploadKey = uuid();
      const photoForm = { kind: "UPLOAD", productId } as const;
      await expect(uploadReviewImage(db, storage, unassigned, uuid(), photoForm, png)).rejects.toMatchObject({code: "NOT_FOUND"});
      const uploaded = await uploadReviewImage(db, storage, principal, uploadKey, photoForm, png);
      expect((await uploadReviewImage(db, storage, principal, uploadKey, photoForm, png)).body).toEqual(uploaded.body);
      const request = await uploadReviewImage(db, storage, principal, uuid(), { kind: "REQUEST",
        productId, basePhotoId: uploaded.body.photoId, mode: "INSET", detail: "ფრეზი" }, png);
      const renderKey = uuid();
      const layout = { requestId: request.body.id, productId, model: "local", placement: { x: 53, y: 30, size: 40 } } as const;
      const preview = await renderReviewDraft(db, storage, principal, renderKey, layout);
      expect((await renderReviewDraft(db, storage, principal, renderKey, layout)).body).toEqual(preview.body);
      expect((await getReviewProduct(db, principal, productId)).photos).toHaveLength(2);
      await acceptReviewDraft(db, principal, uuid(), { productId, previewId: preview.body.id });
      await acceptReviewDraft(db, principal, uuid(), { productId, previewId: preview.body.id });
      const after = await getReviewProduct(db, principal, productId);
      expect(after.photos).toHaveLength(3);
      expect(after.photoWork.map(row => row.event.kind).sort()).toEqual(["ACCEPT","PREVIEW","RENDER","REQUEST","UPLOAD"]);
      await expect(getReviewPhoto(db, unassigned, productId, request.body.photoId)).rejects.toMatchObject({code: "NOT_FOUND"});

      // Workbench: a deterministic adjustment becomes an ordinary photo; a clean-up is stored as an AI edit.
      const adjust = await requestReviewEdit(db, storage, principal, uuid(), { productId, basePhotoId: uploaded.body.photoId, mode: "ADJUST" });
      await expect(renderReviewDraft(db, storage, principal, uuid(), { productId, requestId: adjust.body.id, model: "local" }))
        .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const adjusted = await renderReviewDraft(db, storage, principal, uuid(), { productId, requestId: adjust.body.id, model: "local",
        settings: { rotate: 90, tone: true, trim: false } });
      await acceptReviewDraft(db, principal, uuid(), { productId, previewId: adjusted.body.id });
      const origins = (await getReviewProduct(db, principal, productId)).photos.map(photo => photo.audit.origin);
      expect(origins).toContain("ADJUSTED");
      await expect(requestReviewEdit(db, storage, principal, uuid(), { productId, basePhotoId: uploaded.body.photoId, mode: "CLEAN" }))
        .rejects.toThrow();
      const clean = await requestReviewEdit(db, storage, principal, uuid(), { productId, basePhotoId: uploaded.body.photoId,
        mode: "CLEAN", detail: "ყუთი" });
      vi.stubEnv("REVIEW_OPENAI_API_KEY", "");
      await expect(renderReviewDraft(db, storage, principal, uuid(), { productId, requestId: clean.body.id,
        model: "gpt-image-2.6-sunburst", placement: { x: 10, y: 10, size: 30 } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      vi.stubEnv("REVIEW_OPENAI_API_KEY", "test-only");
      const green = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNg+M8AAAICAQB7CYF4AAAAAElFTkSuQmCC";
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ b64_json: green }] })));
      try {
        const cleaned = await renderReviewDraft(db, storage, principal, uuid(), { productId, requestId: clean.body.id,
          model: "gpt-image-2.6-sunburst", placement: { x: 10, y: 10, size: 30 } });
        const rejectKey = uuid(), rejection = { productId, previewId: cleaned.body.id, note: "პროდუქტი შეიცვალა" };
        await rejectReviewDraft(db, principal, rejectKey, rejection);
        await rejectReviewDraft(db, principal, rejectKey, rejection);
        await rejectReviewDraft(db, principal, uuid(), rejection);
        const work = (await getReviewProduct(db, principal, productId)).photoWork.map(row => row.event);
        expect(work.filter(e => e.kind === "REJECT")).toEqual([expect.objectContaining({ parentId: cleaned.body.id, note: "პროდუქტი შეიცვალა" })]);
        expect(work.find(e => e.kind === "RENDER" && e.parentId === clean.body.id)).toMatchObject({ model: "gpt-image-2.6-sunburst" });
        const cleanedPhoto = work.find(e => e.id === cleaned.body.id)!.photoId!;
        const [cleanedAsset] = await db.select().from(catalogReviewPhotos).where(eq(catalogReviewPhotos.id, cleanedPhoto));
        expect(cleanedAsset?.audit).toMatchObject({ origin: "AI_EDIT" });
        await expect(rejectReviewDraft(db, principal, uuid(), { productId, previewId: adjusted.body.id, note: "x" }))
          .rejects.toMatchObject({ code: "CONFLICT" });
        // Sixteen paid calls per product at most; the attempt is recorded before the provider is contacted.
        for (let i = 1; i < 16; i++) await renderReviewDraft(db, storage, principal, uuid(), { productId, requestId: clean.body.id,
          model: "gpt-image-2.6-flare", placement: { x: 10, y: 10, size: 30 } });
        await expect(renderReviewDraft(db, storage, principal, uuid(), { productId, requestId: clean.body.id,
          model: "gpt-image-2.6-flare", placement: { x: 10, y: 10, size: 30 } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, accepted.body.id), eq(auditLogs.action, "CATALOG_REVIEW_DECIDED")))).toHaveLength(1);
    expect(await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, nameProposal))).toHaveLength(4);
    await expect(db.update(catalogReviewDecisions).set({ note: "Overwrite" }).where(eq(catalogReviewDecisions.id, accepted.body.id))).rejects.toThrow();
    expect((await db.execute(sql`SELECT count(*) AS total, md5(string_agg(id::text || ':' || lifecycle_state, ',' ORDER BY id)) AS states FROM skus`)).rows).toEqual(before.rows);
  });

  it("rejects production, alternate hosts, connection overrides and mismatched database targets", () => {
    const base = {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://hub_app@127.0.0.1:5545/review_test",
      DATABASE_MIGRATOR_URL: "postgres://hub_migrator@127.0.0.1:5545/review_test"
    };
    expect(() => assertLocalReviewDatabase(base)).not.toThrow();
    for (const env of [
      { ...base, NODE_ENV: "production" },
      { ...base, DATABASE_URL: base.DATABASE_URL.replace("127.0.0.1", "staging.example.test") },
      { ...base, DATABASE_URL: base.DATABASE_URL + "?host=example.test" },
      { ...base, DATABASE_URL: base.DATABASE_URL.replace("5545", "5435") },
      { ...base, MEDIA_STORAGE_DRIVER: "s3" }
    ]) expect(() => assertLocalReviewDatabase(env)).toThrow();
  });
});

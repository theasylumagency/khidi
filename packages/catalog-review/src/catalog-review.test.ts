import { afterAll, describe, expect, it } from "vitest";
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

    const approve = { proposalId: nameProposal, revision: 0, action: "APPROVE" } as const;
    const key = uuid();
    const accepted = await recordReviewDecision(db, principal, key, approve);
    expect(await recordReviewDecision(db, principal, key, approve)).toMatchObject({ replayed: true, body: accepted.body });
    await expect(recordReviewDecision(db, principal, key, { ...approve, action: "REJECT" })).rejects.toMatchObject({ code: "CONFLICT" });
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

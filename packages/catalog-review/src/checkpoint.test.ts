import { afterAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import {
  auditLogs, catalogLegacyProducts, catalogReviewAssignments, catalogReviewBatches, catalogReviewProposals,
  closeAppPool, connectMigratorDatabase, getDb, users
} from "@khidi/db";
import { createUuidV7 as uuid } from "@khidi/shared";
import { getReviewCheckpoint, listReviewCheckpoints, listReviewProducts, markReviewCheckpointViewed, recordReviewDecision } from "./index.ts";

afterAll(closeAppPool);

it("counts distinct personally reviewed products, includes deferrals, and freezes one report at twenty", async () => {
  const db = getDb(), migrator = connectMigratorDatabase();
  const batchId = uuid(), reviewerId = uuid(), otherId = uuid();
  const items = Array.from({ length: 21 }, (_, index) => ({ id: uuid(), proposalId: uuid(), wordpressId: 100 + index }));
  const partial = items[19]!;
  const extra = uuid();
  const reviewer: AuthenticatedPrincipal = {
    userId: reviewerId, role: "CATALOG_REVIEWER", email: null, fullName: "Checkpoint test", locale: "ka",
    entityIds: [], permissions: [], authMethod: "OFFICE_PASSWORD_TOTP", deviceId: null
  };
  const other = { ...reviewer, userId: otherId };
  try {
    await migrator.db.transaction(async (tx) => {
      await tx.insert(users).values([reviewerId, otherId].map((id) => ({
        id, fullName: "Checkpoint test", email: `${id}@example.test`, role: "CATALOG_REVIEWER"
      })));
      await tx.insert(catalogReviewBatches).values({ id: batchId,
        sourceSha256: batchId.replaceAll("-", "").repeat(2), sources: {} });
      await tx.insert(catalogReviewAssignments).values([reviewerId, otherId].map((userId) => ({ batchId, userId })));
      await tx.insert(catalogLegacyProducts).values(items.map((item, index) => ({
        id: item.id, batchId, wordpressId: item.wordpressId, sourceStatus: "PUBLISHED" as const,
        recommendedOrder: index < 19 ? index + 1 : index === 20 ? 20 : null,
        baseline: { "არსებული სახელი": `Product ${item.wordpressId}` }, reviewSource: {}
      })));
      const base = { original: "old", proposed: "new", observation: "observed", rationale: "reason" };
      await tx.insert(catalogReviewProposals).values([
        ...items.map((item) => ({ ...base, id: item.proposalId, productId: item.id, field: "NAME" as const })),
        { ...base, id: extra, productId: partial.id, field: "SHORT" }
      ]);
    });
  } finally {
    await migrator.close();
  }

  for (const item of items.slice(0, 19)) {
    await recordReviewDecision(db, reviewer, uuid(), {
      proposalId: item.proposalId, revision: 0, action: item === items[0] ? "DEFER" : "APPROVE"
    });
  }
  // A repeat on one product and another reviewer's decision on the remaining field cannot finish the twentieth.
  await recordReviewDecision(db, reviewer, uuid(), {
    proposalId: items[1]!.proposalId, revision: 1, action: "EDIT", editedText: "Revised"
  });
  await recordReviewDecision(db, other, uuid(), { proposalId: partial.proposalId, revision: 0, action: "REJECT" });
  await recordReviewDecision(db, reviewer, uuid(), { proposalId: extra, revision: 0, action: "DEFER", note: "Check source" });
  expect(await listReviewCheckpoints(db, reviewer)).toEqual([]);
  expect((await listReviewProducts(db, reviewer)).filter((item) => item.pending === 0)).toHaveLength(19);
  expect((await listReviewProducts(db, reviewer)).find((item) => item.id === partial.id)).toMatchObject({
    pending: 1, deferred: 1, recommendedOrder: null
  });

  const final = { proposalId: partial.proposalId, revision: 1, action: "APPROVE" } as const;
  const key = uuid();
  await Promise.all([recordReviewDecision(db, reviewer, key, final), recordReviewDecision(db, reviewer, key, final)]);
  const [offer] = await listReviewCheckpoints(db, reviewer);
  expect(offer).toMatchObject({ batchId, viewedAt: null });
  const report = await getReviewCheckpoint(db, reviewer, offer!.id);
  expect(report.report.map((item) => item.wordpressId)).toEqual(items.slice(0, 20).map((item) => item.wordpressId));
  expect(report.report[0]?.outcomes[0]?.action).toBe("DEFER");
  expect(report.report[1]?.outcomes[0]).toMatchObject({ action: "EDIT", editedText: "Revised" });
  expect(report.report[19]?.outcomes).toContainEqual(expect.objectContaining({ action: "DEFER", note: "Check source" }));
  await expect(getReviewCheckpoint(db, other, report.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(markReviewCheckpointViewed(db, other, report.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

  await Promise.all([markReviewCheckpointViewed(db, reviewer, report.id), markReviewCheckpointViewed(db, reviewer, report.id)]);
  expect((await listReviewCheckpoints(db, reviewer))[0]?.viewedAt).toBeInstanceOf(Date);
  await recordReviewDecision(db, reviewer, uuid(), { proposalId: items[20]!.proposalId, revision: 0, action: "APPROVE" });
  await recordReviewDecision(db, reviewer, uuid(), { proposalId: items[0]!.proposalId, revision: 1, action: "APPROVE" });
  expect(await listReviewCheckpoints(db, reviewer)).toHaveLength(1);
  expect((await getReviewCheckpoint(db, reviewer, report.id)).report).toEqual(report.report);
  for (const action of ["CATALOG_REVIEW_CHECKPOINT_CREATED", "CATALOG_REVIEW_CHECKPOINT_VIEWED"]) {
    expect(await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.entityId, report.id), eq(auditLogs.action, action))))
      .toHaveLength(1);
  }
});

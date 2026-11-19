import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { catalogLegacyProducts, catalogReviewAssignments, catalogReviewBatches, catalogReviewProposals, catalogReviewPhotos, catalogReviewPhotoLinks,
  connectMigratorDatabase, users, type AppDatabase } from "@khidi/db";
import { createUuidV7 as uuid } from "@khidi/shared";
import { getReviewProduct, listReviewProducts, recordReviewDecision, createReviewText } from "./index.ts";
import { listPilot, savePilot, type FeedbackResponse } from "./pilot.ts";
import { pilotBaseline, pilotCards } from "./pilot-cards.ts";
import { lockPilotPhotoWork } from "./access.ts";

it("keeps all twenty responses, rejects the twenty-first and never releases on report view", async () => {
  const migrator = connectMigratorDatabase(), rollback = new Error("rollback pilot fixture");
  const person: AuthenticatedPrincipal = { userId: uuid(), role: "CATALOG_REVIEWER", email: null, fullName: "Reviewer",
    locale: "ka", entityIds: [], permissions: [], authMethod: "OFFICE_PASSWORD_TOTP", deviceId: null };
  const admin = { ...person, role: "ADMIN" as const, userId: uuid() };
  const outsider = { ...person, userId: uuid() };
  const batch = uuid();
  const items = [...pilotCards.map(card => card.wp), 987654].map(wp => ({ wp, id: uuid(), proposal: uuid() }));
  try {
    await expect(migrator.db.transaction(async tx => {
      await tx.insert(users).values([person, admin, outsider].map(p => ({
        id: p.userId, fullName: p.fullName, email: p.userId + "@example.test", role: p.role
      })));
      await tx.insert(catalogReviewBatches).values({ id: batch, createdAt: new Date("2000-01-01T00:00:00Z"), sources: { baseline: pilotBaseline },
        sourceSha256: batch.replaceAll("-", "").repeat(2) });
      await tx.insert(catalogReviewAssignments).values({ batchId: batch, userId: person.userId });
      const older = uuid(), alternate = uuid();
      await tx.insert(catalogReviewBatches).values({ id: older, sources: {}, sourceSha256: older.replaceAll("-", "").repeat(2) });
      await tx.insert(catalogReviewAssignments).values({ batchId: older, userId: person.userId });
      await tx.insert(catalogLegacyProducts).values({ id: alternate, batchId: older, wordpressId: 999, sourceStatus: "DRAFT", baseline: {}, reviewSource: {} });
      await tx.insert(catalogReviewProposals).values({ id: uuid(), productId: alternate, field: "NAME", proposed: "alternate",
        observation: "source", rationale: "source" });
      await tx.insert(catalogLegacyProducts).values(items.map((p,i) => ({ id: p.id, batchId: batch, wordpressId: p.wp,
        sourceStatus: "PUBLISHED" as const, baseline: {}, reviewSource: {}, recommendedOrder: i < 20 ? i+1 : null })));
      await tx.insert(catalogReviewProposals).values(items.map(p => ({ id: p.proposal, productId: p.id,
        field: "NAME" as const, proposed: "old", observation: "source", rationale: "source" })));
      const photoId = uuid();
      await tx.insert(catalogReviewPhotos).values({ id: photoId, batchId: batch, assetKey: "fixture", sourceUrl: "https://example.test/p.jpg",
        audit: {}, rawKey: "raw/fixture", rawSha256: "a".repeat(64), previewKey: "master/fixture", previewSha256: "a".repeat(64) });
      await tx.insert(catalogReviewPhotoLinks).values({ batchId: batch, productId: items[0]!.id, photoId, position: 1 });
      await tx.execute(sql`SET LOCAL ROLE hub_app`);
      const db = tx as unknown as AppDatabase;
      const first = items[0]!, extra = items[20]!;
      const response: FeedbackResponse = { outcome: "OK", correction: "", targets: [], answers: [], fieldChange: "", fieldNote: "",
        photoId: null, photoNote: "" };
      expect(await listPilot(db, outsider)).toEqual([]);
      expect(await listPilot(db, admin)).toHaveLength(20);
      expect((await listReviewProducts(db, person)).map(r => r.id)).not.toContain(extra.id);
      await expect(getReviewProduct(db, person, extra.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(getReviewProduct(db, person, alternate)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(recordReviewDecision(db, person, uuid(), { proposalId: extra.proposal, revision: 0,
        action: "DEFER" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(createReviewText(db, person, uuid(), { productId: extra.id, field: "FULL", text: "x" }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(savePilot(db, admin, uuid(), { productId: first.id, revision: 0, submit: false, response }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(savePilot(db, person, uuid(), { productId: extra.id, revision: 0, submit: true, response }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      const answered = pilotCards[0]!.questions.map(() => ({ state: "KNOWN" as const, text: "observed", source: "plate" }));
      const draft = { productId: first.id, revision: 0, submit: false, response: { ...response, answers: answered } };
      const key = uuid(), initial = await savePilot(db, person, key, draft);
      expect((await savePilot(db, person, key, draft)).body).toEqual(initial.body);
      await expect(savePilot(db, person, uuid(), draft)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(savePilot(db, person, uuid(), { ...draft, revision: 1, response: { ...draft.response, photoId: uuid() } }))
        .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(savePilot(db, person, uuid(), { ...draft, revision: 1, submit: true, response: { ...draft.response,
        answers: answered.map(a => ({ ...a, source: "" })) } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      for (const [i, card] of pilotCards.entries()) {
        await savePilot(db, person, uuid(), { productId: items[i]!.id, revision: i === 0 ? 1 : 0, submit: true,
          response: { ...response, photoId: i === 0 ? photoId : null, answers: i === 0 ? answered : card.questions.map(() => ({ state: "UNKNOWN", text: "", source: "" })) } });
      }
      const observed = await listPilot(db, admin);
      expect(observed.filter(r => r.submitted)).toHaveLength(20);
      expect(observed[0]?.response?.answers[0]?.source).toBe("plate");
      expect(observed[0]?.response?.photoId).toBe(photoId);
      await expect(lockPilotPhotoWork(db, person, first.id)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(savePilot(db, person, uuid(), { ...draft, revision: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(getReviewProduct(db, admin, extra.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      throw rollback;
    })).rejects.toBe(rollback);
  } finally { await migrator.close(); }
});

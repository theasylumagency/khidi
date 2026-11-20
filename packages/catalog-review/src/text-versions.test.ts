import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import {
  auditLogs, catalogLegacyProducts as products, catalogReviewAssignments, catalogReviewBatches,
  catalogReviewDecisions as decisions, catalogReviewProposals as proposals, closeAppPool,
  connectMigratorDatabase, getDb, outboxEvents, users
} from "@khidi/db";
import { createUuidV7 as uuid } from "@khidi/shared";
import { createReviewText, getReviewProduct, listReviewProducts, recordReviewDecision } from "./index.ts";

afterAll(closeAppPool);

async function fixture() {
  const migrator = connectMigratorDatabase();
  const batchId = uuid(), productId = uuid(), photoProposalId = uuid();
  const reviewerId = uuid(), otherId = uuid(), unassignedId = uuid(), adminId = uuid();
  const baseline = { "არსებული სახელი": "", "არსებული მოკლე აღწერა": "", "არსებული სრული აღწერა": "წყარო" };
  try {
    await migrator.db.transaction(async (tx) => {
      await tx.insert(users).values([reviewerId, otherId, unassignedId, adminId].map((id) => ({
        id, email: `${id}@example.test`, fullName: "Text review test", role: id === adminId ? "ADMIN" as const : "CATALOG_REVIEWER" as const
      })));
      await tx.insert(catalogReviewBatches).values({ id: batchId, sourceSha256: batchId.replaceAll("-", "").repeat(2), sources: {} });
      await tx.insert(catalogReviewAssignments).values([reviewerId, otherId].map((userId) => ({ batchId, userId })));
      await tx.insert(products).values({ id: productId, batchId, wordpressId: 7161, sourceStatus: "PUBLISHED", baseline, reviewSource: {} });
      await tx.insert(proposals).values({ id: photoProposalId, productId, field: "PHOTO", observation: "source", rationale: "photo" });
    });
  } finally { await migrator.close(); }
  const principal: AuthenticatedPrincipal = { userId: reviewerId, role: "CATALOG_REVIEWER", email: null, fullName: "Text review test",
    locale: "ka", entityIds: [], permissions: [], authMethod: "OFFICE_PASSWORD_TOTP", deviceId: null };
  return { productId, photoProposalId, baseline, principal, other: { ...principal, userId: otherId },
    unassigned: { ...principal, userId: unassignedId }, admin: { ...principal, userId: adminId, role: "ADMIN" as const } };
}

describe("manual catalog text and exact approvals", () => {
  it("creates a missing field once, preserves source, and approves the exact saved text including whitespace", async () => {
    const f = await fixture(), db = getDb(), key = uuid();
    const text = "  მოტობლოკი MQ170GS\n\n7 ცხ.ძ. 🛠️  ";
    const input = { productId: f.productId, field: "NAME", text, note: "შესავსები ველი" } as const;
    const saved = await createReviewText(db, f.principal, key, input);
    expect(await createReviewText(db, f.principal, key, input)).toMatchObject({ replayed: true, body: saved.body });
    await expect(createReviewText(db, f.principal, key, { ...input, text: "changed" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const detail = await getReviewProduct(db, f.principal, f.productId);
    expect(detail.product.baseline).toEqual(f.baseline);
    expect(detail.proposals.find((p) => p.id === saved.body.proposalId)).toMatchObject({ origin: "MANUAL", createdBy: f.principal.userId, original: "", proposed: text });
    expect(detail.history[0]).toMatchObject({ action: "EDIT", editedText: text, approvedText: null });
    expect(await listReviewProducts(db, f.principal)).toMatchObject([{ total: 2, pending: 1, name: text }]);
    expect(await listReviewProducts(db, f.other)).toMatchObject([{ name: "", pending: 2 }]);
    // An administrator sees every batch; other test files may have left products behind, so select this fixture's product.
    expect((await listReviewProducts(db, f.admin)).filter((p) => p.id === f.productId)).toMatchObject([{ name: text }]);
    const approve = { proposalId: saved.body.proposalId, revision: 1, action: "APPROVE", textVersion: saved.body.id } as const;
    const approvalKey = uuid(), accepted = await recordReviewDecision(db, f.principal, approvalKey, approve);
    expect(await recordReviewDecision(db, f.principal, approvalKey, approve)).toMatchObject({ replayed: true, body: accepted.body });
    const [snapshot] = await db.select().from(decisions).where(eq(decisions.id, accepted.body.id));
    expect(snapshot).toMatchObject({ action: "APPROVE", approvedText: text, approvedTextEditId: saved.body.id, editedText: null });
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, saved.body.proposalId))).toHaveLength(1);
    expect(await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, saved.body.proposalId))).toHaveLength(2);
    await expect(db.update(proposals).set({ proposed: "overwrite" }).where(eq(proposals.id, saved.body.proposalId))).rejects.toThrow();
    await expect(db.update(decisions).set({ approvedText: "overwrite" }).where(eq(decisions.id, accepted.body.id))).rejects.toThrow();
  });

  it("serializes two authors filling the same field and retains the losing author's retry as a conflict", async () => {
    const f = await fixture(), db = getDb();
    const input = { productId: f.productId, field: "SHORT", text: "აღწერა" } as const;
    const race = await Promise.allSettled([
      createReviewText(db, f.principal, uuid(), input), createReviewText(db, f.other, uuid(), { ...input, text: "სხვა აღწერა" })
    ]);
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(race.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(await db.select().from(proposals).where(and(eq(proposals.productId, f.productId), eq(proposals.field, "SHORT")))).toHaveLength(1);
    expect(await db.select().from(decisions).where(eq(decisions.productId, f.productId))).toHaveLength(1);
    await expect(createReviewText(db, f.principal, uuid(), input)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps assignment/role boundaries and rejects empty text without creating a field", async () => {
    const f = await fixture(), db = getDb();
    const input = { productId: f.productId, field: "NAME", text: "name" } as const;
    await expect(createReviewText(db, f.unassigned, uuid(), input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createReviewText(db, { ...f.principal, role: "OPERATOR" }, uuid(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createReviewText(db, { ...f.admin, authMethod: "WAREHOUSE_PIN" }, uuid(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createReviewText(db, f.principal, uuid(), { ...input, text: " \n " })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createReviewText(db, f.principal, uuid(), { ...input, text: "x".repeat(20001) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await db.select().from(proposals).where(eq(proposals.productId, f.productId))).toHaveLength(1);
    expect((await createReviewText(db, f.admin, uuid(), input)).status).toBe(201);
  });

  it("selects an explicit older edit, rejects cross-field sources, and prevents stale approval", async () => {
    const f = await fixture(), db = getDb();
    const first = await createReviewText(db, f.principal, uuid(), { productId: f.productId, field: "FULL", text: "პირველი\n112 კგ" });
    const otherField = await createReviewText(db, f.principal, uuid(), { productId: f.productId, field: "NAME", text: "სხვა ველი" });
    const proposalId = first.body.proposalId;
    const second = await recordReviewDecision(db, f.other, uuid(), { proposalId, revision: 1, action: "EDIT", editedText: "მეორე ვერსია" });
    await expect(recordReviewDecision(db, f.principal, uuid(), { proposalId, revision: 1, action: "APPROVE", textVersion: first.body.id }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    for (const textVersion of [undefined, "PROPOSAL", uuid(), otherField.body.id]) {
      await expect(recordReviewDecision(db, f.principal, uuid(), { proposalId, revision: 2, action: "APPROVE", textVersion }))
        .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    const approved = await recordReviewDecision(db, f.principal, uuid(), { proposalId, revision: 2, action: "APPROVE", textVersion: first.body.id });
    expect((await getReviewProduct(db, f.principal, f.productId)).history.find((d) => d.id === approved.body.id))
      .toMatchObject({ approvedText: "პირველი\n112 კგ", approvedTextEditId: first.body.id });
    await expect(recordReviewDecision(db, f.principal, uuid(), { proposalId, revision: 3, action: "APPROVE", textVersion: approved.body.id }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await recordReviewDecision(db, f.principal, uuid(), { proposalId, revision: 3, action: "APPROVE", textVersion: second.body.id });
    expect((await getReviewProduct(db, f.principal, f.productId)).history[0]).toMatchObject({ approvedText: "მეორე ვერსია" });
  });

  it("enforces snapshot equality in PostgreSQL even for a direct runtime insert", async () => {
    const f = await fixture(), db = getDb();
    const edit = await createReviewText(db, f.principal, uuid(), { productId: f.productId, field: "NAME", text: "exact" });
    const base = { id: uuid(), proposalId: edit.body.proposalId, productId: f.productId, field: "NAME" as const,
      revision: 2, actorId: f.principal.userId, action: "APPROVE" as const };
    await expect(db.insert(decisions).values(base)).rejects.toThrow();
    await expect(db.insert(decisions).values({ ...base, approvedText: "forged", approvedTextEditId: edit.body.id })).rejects.toThrow();
    await expect(db.insert(proposals).values({ id: uuid(), productId: f.productId, field: "SHORT", proposed: "spoofed",
      observation: "source", rationale: "source", origin: "IMPORT" })).rejects.toThrow();
    expect(await db.select().from(decisions).where(eq(decisions.proposalId, edit.body.proposalId))).toHaveLength(1);
  });

  it("rolls back proposal, edit and outbox if audit insertion fails", async () => {
    const f = await fixture(), db = getDb(), migrator = connectMigratorDatabase();
    const trigger = `review_failure_${f.principal.userId.replaceAll("-", "")}`;
    try {
      await migrator.db.execute(sql.raw(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.actor_user_id = '${f.principal.userId}'::uuid THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}();`));
      await expect(createReviewText(db, f.principal, uuid(), { productId: f.productId, field: "NAME", text: "rollback" })).rejects.toThrow();
      expect(await db.select().from(proposals).where(eq(proposals.productId, f.productId))).toHaveLength(1);
      expect(await db.select().from(decisions).where(eq(decisions.productId, f.productId))).toHaveLength(0);
      expect(await db.select().from(outboxEvents).where(sql`${outboxEvents.payloadJson}->>'productId' = ${f.productId}`)).toHaveLength(0);
    } finally {
      await migrator.db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs; DROP FUNCTION IF EXISTS ${trigger}();`));
      await migrator.close();
    }
  });
});

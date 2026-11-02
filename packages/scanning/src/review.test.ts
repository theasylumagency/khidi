import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { IDBFactory } from "fake-indexeddb";
import { loadPrincipalByUserId, type AuthenticatedPrincipal } from "@khidi/auth";
import { auditLogs, getDb, idempotencyKeys, intakeReviewActions, productIntakes, scanTasks, skuIdentifiers, skus, users } from "@khidi/db";
import { attachSkuIdentifier, createSkuDraft, transitionSkuLifecycle } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { createScanTask, getIntakeReview, listIntakes, markLabelsPrinted, receiveIntake, reportOfflineDiscard, resolveIntakeReview } from "./index.ts";
import { OfflineScanQueue, openScanQueue } from "./offline.ts";
import type { IntakeInput } from "./contracts.ts";

describe("S8 ADR-005 intake review", () => {
  const db = getDb(); let admin: AuthenticatedPrincipal, warehouse: AuthenticatedPrincipal;
  beforeAll(async () => {
    const [a] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
    const [w] = await db.select().from(users).where(eq(users.role, "WAREHOUSE")).limit(1);
    admin = await loadPrincipalByUserId(db, a!.id); warehouse = await loadPrincipalByUserId(db, w!.id);
  });
  const input = (overrides: Partial<IntakeInput> = {}): IntakeInput => ({ userId: admin.userId, deviceId: createUuidV7(),
    idempotencyKey: createUuidV7(), scannedAt: "2026-01-02T03:04:05.000Z", sourceMode: "QUICK_SCAN", taskId: null,
    scannedValue: `review-${createUuidV7()}`, isNoBarcode: false, ...overrides });
  async function task() { return (await createScanTask(db, admin, { idempotencyKey: createUuidV7(), taskType: "INTAKE_UNIQUE", title: "Review test", assigneeRole: "WAREHOUSE", targetCount: 3 })).body.id; }
  async function counts() {
    const result = await db.execute(sql`SELECT (SELECT count(*)::int FROM skus) AS skus, (SELECT count(*)::int FROM sku_identifiers) AS identifiers`);
    return result.rows[0];
  }
  const unknownLabel = () => `KH-${BigInt(`0x${createUuidV7().replaceAll("-", "")}`).toString().slice(-18)}`;
  async function pendingTask(scannedValue?: string, noBarcode = false) {
    const taskId = await task(); await db.update(scanTasks).set({ status: "CANCELLED" }).where(eq(scanTasks.id, taskId));
    const scan = input({ userId: warehouse.userId, sourceMode: "TASK", taskId, isNoBarcode: noBarcode, scannedValue: noBarcode ? "" : scannedValue ?? `late-${createUuidV7()}` });
    return { taskId, scan, accepted: await receiveIntake(db, warehouse, scan) };
  }
  it("records unknown and archived internal labels for review without changing the catalog", async () => {
    const taskId = await task(); const before = await counts();
    const scan = input({ scannedValue: unknownLabel(), sourceMode: "TASK", taskId });
    const first = await receiveIntake(db, admin, scan), second = await receiveIntake(db, admin, { ...scan, idempotencyKey: createUuidV7() });
    expect(first.body).toMatchObject({ reviewReason: "UNKNOWN_INTERNAL_LABEL", matchedSkuId: null, duplicateOfIntakeId: null, resultState: "MANUAL_IDENTIFICATION_REQUIRED" });
    expect(second.body.duplicateOfIntakeId).toBeNull(); expect(await counts()).toEqual(before);
    const draft = await createSkuDraft(db, { userId: admin.userId }, {}); await transitionSkuLifecycle(db, { userId: admin.userId }, draft.id, "ARCHIVED");
    const archivedBefore = await counts(); const archived = await receiveIntake(db, admin, input({ scannedValue: `khidi://sku/${draft.internalSku}`, sourceMode: "TASK", taskId }));
    expect(archived.body).toMatchObject({ reviewReason: "ARCHIVED_INTERNAL_LABEL", matchedSkuId: null }); expect(await counts()).toEqual(archivedBefore);
    expect((await getIntakeReview(db, admin, archived.body.id)).intake.reviewReferenceSkuId).toBe(draft.id);
    const [progress] = await db.select().from(scanTasks).where(eq(scanTasks.id, taskId)); expect(progress!.completedCount).toBe(0);
  });
  it("keeps collisions out of progress and duplicate detection", async () => {
    const taskId = await task(); const code = `collision-${createUuidV7()}`;
    for (let i = 0; i < 2; i++) { const draft = await createSkuDraft(db, { userId: admin.userId }, {}); await attachSkuIdentifier(db, { userId: admin.userId }, { skuId: draft.id, identifierType: "SUPPLIER_CODE", value: code }); }
    const before = await counts();
    for (let i = 0; i < 2; i++) expect((await receiveIntake(db, admin, input({ sourceMode: "TASK", taskId, scannedValue: code }))).body).toMatchObject({ reviewReason: "IDENTIFIER_COLLISION", matchedSkuId: null, duplicateOfIntakeId: null });
    expect(await counts()).toEqual(before);
    const [progress] = await db.select().from(scanTasks).where(eq(scanTasks.id, taskId)); expect(progress!.completedCount).toBe(0);
  });
  it("accepts an offline scan after cancellation into server review, and task exceptions never create drafts", async () => {
    const taskId = await task(); const scan = input({ sourceMode: "TASK", taskId, userId: warehouse.userId });
    const store = await openScanQueue(new IDBFactory()); await store.add(scan, "Scanner");
    await db.update(scanTasks).set({ status: "CANCELLED" }).where(eq(scanTasks.id, taskId));
    const before = await counts();
    const queue = new OfflineScanQueue(store, { currentUserId: async () => warehouse.userId, send: async (body) => {
      const result = await receiveIntake(db, warehouse, body); expect(result.body.reviewReason).toBe("TASK_NOT_ACCEPTING");
      return { accepted: true, status: result.status, reviewReason: result.body.reviewReason };
    } });
    await queue.flush(); expect(await store.list()).toEqual([]); store.close(); expect(await counts()).toEqual(before);
    const other = await task(); await db.update(scanTasks).set({ assigneeRole: null, assigneeUserId: admin.userId }).where(eq(scanTasks.id, other));
    const reassigned = await receiveIntake(db, warehouse, input({ sourceMode: "TASK", taskId: other, userId: warehouse.userId }));
    expect(reassigned.body).toMatchObject({ reviewReason: "TASK_NOT_ASSIGNED", resultState: "MANUAL_IDENTIFICATION_REQUIRED", matchedSkuId: null });
    expect(await counts()).toEqual(before);
    const draft = await createSkuDraft(db, { userId: admin.userId }, {});
    const referenced = await receiveIntake(db, warehouse, input({ sourceMode: "TASK", taskId: other, userId: warehouse.userId, scannedValue: draft.internalSku }));
    expect(referenced.body).toMatchObject({ reviewReason: "TASK_NOT_ASSIGNED", resultState: "MATCHED_EXISTING", matchedSkuId: draft.id });
  });
  it("links an unknown label to an active SKU, queues its replacement and keeps acceptance replay stable", async () => {
    const scan = input({ scannedValue: unknownLabel() }); const accepted = await receiveIntake(db, admin, scan);
    const target = await createSkuDraft(db, { userId: admin.userId }, {}); const before = await counts();
    const action = { idempotencyKey: createUuidV7(), intakeId: accepted.body.id, resolution: "LINK_EXISTING", skuCode: target.internalSku, note: "Wrong label; identified manually" };
    const first = await resolveIntakeReview(db, admin, action), replay = await resolveIntakeReview(db, admin, action);
    expect(first.body).toMatchObject({ resolved: true, matchedSkuId: target.id, labelStatus: "TO_PRINT" }); expect(replay.replayed).toBe(true);
    expect(await counts()).toEqual(before);
    await db.update(idempotencyKeys).set({ expiresAt: new Date(0) }).where(and(eq(idempotencyKeys.scope, "scanning:review"), eq(idempotencyKeys.idempotencyKey, action.idempotencyKey)));
    expect((await resolveIntakeReview(db, admin, action)).body).toEqual(first.body);
    expect(await db.select().from(intakeReviewActions).where(eq(intakeReviewActions.id, action.idempotencyKey))).toHaveLength(1);
    await expect(db.update(intakeReviewActions).set({ requestHash: "tampered" }).where(eq(intakeReviewActions.id, action.idempotencyKey))).rejects.toThrow();
    await markLabelsPrinted(db, admin, { idempotencyKey: createUuidV7(), intakeIds: [accepted.body.id] });
    await receiveIntake(db, admin, input({ scannedValue: target.internalSku }));
    expect((await getIntakeReview(db, admin, accepted.body.id)).intake.labelStatus).toBe("ATTACHED");
    await db.update(idempotencyKeys).set({ expiresAt: new Date(0) }).where(and(eq(idempotencyKeys.scope, "scanning:intake"), eq(idempotencyKeys.idempotencyKey, scan.idempotencyKey)));
    expect((await receiveIntake(db, admin, scan)).body).toEqual(accepted.body);
  });
  it("requires admin authorization and a note, and creates the draft only on explicit acceptance/reopening", async () => {
    const { taskId, accepted } = await pendingTask(); const before = await counts();
    const action = { idempotencyKey: createUuidV7(), intakeId: accepted.body.id, resolution: "ACCEPT_FOR_TASK", note: "Accept the original physical scan" };
    await expect(resolveIntakeReview(db, warehouse, action)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resolveIntakeReview(db, admin, { ...action, note: " " })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(resolveIntakeReview(db, admin, action)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(await counts()).toEqual(before);
    const result = await resolveIntakeReview(db, admin, { ...action, reopenTask: true });
    const row = (await getIntakeReview(db, admin, accepted.body.id)).intake;
    expect(result.body.resolved).toBe(true); expect(row).toMatchObject({ reviewReason: null, reviewOriginalReason: "TASK_NOT_ACCEPTING", resultState: "NEW_DRAFT", reviewResolution: "ACCEPT_FOR_TASK" });
    const [progress] = await db.select().from(scanTasks).where(eq(scanTasks.id, taskId)); expect(progress).toMatchObject({ completedCount: 1, status: "IN_PROGRESS", completedAt: null });
    const duplicate = await receiveIntake(db, admin, input({ sourceMode: "TASK", taskId, scannedValue: row.scannedIdentifiersJson[0] }));
    expect(duplicate.body.duplicateOfIntakeId).toBe(row.id);
  });
  it("accepts a no-barcode exception into the label queue and does not count a later duplicate twice", async () => {
    const noBarcode = await pendingTask(undefined, true);
    await resolveIntakeReview(db, admin, { idempotencyKey: createUuidV7(), intakeId: noBarcode.accepted.body.id, resolution: "ACCEPT_FOR_TASK", reopenTask: true, note: "Register unlabelled product" });
    expect((await getIntakeReview(db, admin, noBarcode.accepted.body.id)).intake).toMatchObject({ resultState: "NEW_DRAFT", labelStatus: "TO_PRINT" });
    const duplicate = await pendingTask(); await db.update(scanTasks).set({ status: "OPEN" }).where(eq(scanTasks.id, duplicate.taskId));
    const clean = await receiveIntake(db, admin, { ...duplicate.scan, userId: admin.userId, idempotencyKey: createUuidV7() });
    await resolveIntakeReview(db, admin, { idempotencyKey: createUuidV7(), intakeId: duplicate.accepted.body.id, resolution: "ACCEPT_FOR_TASK", note: "Already represented by the later scan" });
    expect((await getIntakeReview(db, admin, duplicate.accepted.body.id)).intake.duplicateOfIntakeId).toBe(clean.body.id);
    const [progress] = await db.select().from(scanTasks).where(eq(scanTasks.id, duplicate.taskId)); expect(progress!.completedCount).toBe(1);
  });
  it("leaves a newly discovered collision in review and dismisses without deleting history", async () => {
    const pending = await pendingTask();
    for (let i = 0; i < 2; i++) { const draft = await createSkuDraft(db, { userId: admin.userId }, {}); await attachSkuIdentifier(db, { userId: admin.userId }, { skuId: draft.id, identifierType: "SUPPLIER_CODE", value: pending.scan.scannedValue }); }
    const before = await counts();
    const collision = await resolveIntakeReview(db, admin, { idempotencyKey: createUuidV7(), intakeId: pending.accepted.body.id, resolution: "ACCEPT_FOR_TASK", reopenTask: true, note: "Check changed identity" });
    expect(collision.body).toMatchObject({ resolved: false, reviewReason: "IDENTIFIER_COLLISION" }); expect(await counts()).toEqual(before);
    expect((await listIntakes(db, admin, { taskId: pending.taskId, needsReview: "yes" })).rows.map((row) => row.intake.id)).toContain(pending.accepted.body.id);
    await resolveIntakeReview(db, admin, { idempotencyKey: createUuidV7(), intakeId: pending.accepted.body.id, resolution: "DISMISS", note: "Test scan" });
    expect((await listIntakes(db, admin, { taskId: pending.taskId, needsReview: "yes" })).rows).toHaveLength(0);
    expect((await getIntakeReview(db, admin, pending.accepted.body.id)).intake.reviewResolution).toBe("DISMISS");
    await expect(getIntakeReview(db, warehouse, pending.accepted.body.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("enforces review metadata in PostgreSQL and keeps Class B validation/security errors unchanged", async () => {
    const accepted = await receiveIntake(db, admin, input({ scannedValue: unknownLabel() }));
    await expect(db.update(productIntakes).set({ reviewResolution: "DISMISS" }).where(eq(productIntakes.id, accepted.body.id))).rejects.toThrow();
    await expect(receiveIntake(db, admin, input({ idempotencyKey: "invalid" }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(receiveIntake(db, admin, input({ userId: warehouse.userId }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const first = input(); await receiveIntake(db, admin, first);
    await expect(receiveIntake(db, admin, { ...first, scannedValue: "other" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("audits a discard once, including original physical scan metadata, and rejects another owner", async () => {
    const report = { idempotencyKey: createUuidV7(), scanIdempotencyKey: createUuidV7(), userId: warehouse.userId,
      deviceId: createUuidV7(), scannedValue: "bad scan", scannedAt: "2026-01-02T03:04:05.000Z", reason: "Incorrect entry" };
    await expect(reportOfflineDiscard(db, admin, report)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await reportOfflineDiscard(db, warehouse, report); await reportOfflineDiscard(db, warehouse, report);
    await db.update(idempotencyKeys).set({ expiresAt: new Date(0) }).where(and(eq(idempotencyKeys.scope, "scanning:offline-discard"), eq(idempotencyKeys.idempotencyKey, report.idempotencyKey)));
    await reportOfflineDiscard(db, warehouse, report);
    const rows = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "OFFLINE_SCAN_DISCARDED"), eq(auditLogs.entityId, report.idempotencyKey)));
    expect(rows).toHaveLength(1); expect(rows[0]!.afterJson).toMatchObject(report); expect(rows[0]!.actorUserId).toBe(warehouse.userId);
  });
});

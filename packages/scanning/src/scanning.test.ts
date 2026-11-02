import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { loadPrincipalByUserId, type AuthenticatedPrincipal } from "@khidi/auth";
import { auditLogs, getDb, idempotencyKeys, outboxEvents, productIntakes, scanTasks, skuIdentifiers, skus, users } from "@khidi/db";
import { attachSkuIdentifier, computeGs1CheckDigit, createSkuDraft, transitionSkuLifecycle } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { receiveIntake } from "./index.ts";
import type { IntakeInput } from "./contracts.ts";

describe("M3 S2 intake transactions", () => {
  const db = getDb();
  let admin: AuthenticatedPrincipal;
  let warehouse: AuthenticatedPrincipal;
  const key = () => createUuidV7();
  const gtin = () => {
    const payload = (BigInt(`0x${key().replaceAll("-", "")}`) % 1_000_000_000_000n).toString().padStart(12, "0");
    return payload + computeGs1CheckDigit(payload);
  };
  beforeAll(async () => {
    const [a] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
    const [w] = await db.select().from(users).where(eq(users.role, "WAREHOUSE")).limit(1);
    admin = await loadPrincipalByUserId(db, a!.id);
    warehouse = await loadPrincipalByUserId(db, w!.id);
  });
  const input = (changes: Partial<IntakeInput> = {}): IntakeInput => ({
    userId: admin.userId, deviceId: key(), idempotencyKey: key(), scannedAt: "2026-01-02T03:04:05.000Z",
    sourceMode: "QUICK_SCAN", taskId: null, scannedValue: `TEST-${key()}`, isNoBarcode: false, ...changes
  });
  async function task() {
    const [created] = await db.insert(scanTasks).values({ id: key(), title: "Intake test", taskType: "INTAKE_UNIQUE", assigneeRole: "WAREHOUSE", targetCount: 5, createdBy: admin.userId }).returning();
    return created!;
  }
  it("replays once, survives cache expiry, rejects changed payload, and keeps one SKU, audit and event", async () => {
    const scan = input();
    const [first, replay] = await Promise.all([receiveIntake(db, admin, scan), receiveIntake(db, admin, scan)]);
    expect(first.body).toEqual(replay.body);
    expect([first.replayed, replay.replayed].sort()).toEqual([false, true]);
    expect(await db.select().from(productIntakes).where(eq(productIntakes.idempotencyKey, scan.idempotencyKey))).toHaveLength(1);
    expect(await db.select().from(skus).where(eq(skus.id, first.body.matchedSkuId!))).toHaveLength(1);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, first.body.id), eq(auditLogs.action, "PRODUCT_INTAKE_RECORDED")))).toHaveLength(1);
    expect(await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, first.body.id))).toHaveLength(1);
    await db.update(idempotencyKeys).set({ expiresAt: new Date(0) }).where(and(eq(idempotencyKeys.scope, "scanning:intake"), eq(idempotencyKeys.idempotencyKey, scan.idempotencyKey)));
    expect((await receiveIntake(db, admin, scan)).body).toEqual(first.body);
    await expect(receiveIntake(db, admin, { ...scan, scannedValue: "changed" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const [row] = await db.select().from(productIntakes).where(eq(productIntakes.id, first.body.id));
    expect(row!.scannedAt.toISOString()).toBe(scan.scannedAt);
    expect(row!.clientDeviceId).toBe(scan.deviceId);
    expect(row!.createdAt.getTime()).toBeGreaterThan(row!.scannedAt.getTime());
  });
  it("normalizes EAN/GTIN-14 and counts a unique task identifier once, even with simultaneous scans", async () => {
    const assigned = await task();
    const value = gtin();
    const scans = [value, value.padStart(14, "0")].map((scannedValue) => input({ sourceMode: "TASK", taskId: assigned.id, scannedValue }));
    const results = await Promise.all(scans.map((scan) => receiveIntake(db, admin, scan)));
    expect(results.map((r) => r.body.matchedSkuId)[0]).toBe(results[1]!.body.matchedSkuId);
    const original = results.find((r) => r.body.duplicateOfIntakeId === null)!;
    expect(results.find((r) => r.body.duplicateOfIntakeId)?.body.duplicateOfIntakeId).toBe(original.body.id);
    const [progress] = await db.select().from(scanTasks).where(eq(scanTasks.id, assigned.id));
    expect(progress!.completedCount).toBe(1);
    const [identifier] = await db.select().from(skuIdentifiers).where(eq(skuIdentifiers.skuId, original.body.matchedSkuId!)).then((rows) => rows.filter((r) => r.identifierType === "GTIN"));
    expect(identifier).toMatchObject({ value: value.padStart(14, "0"), verified: false });
  });
  it("creates only one draft when two Quick Scans encounter the same unknown code concurrently", async () => {
    const first = input();
    const results = await Promise.all([receiveIntake(db, admin, first), receiveIntake(db, admin, input({ scannedValue: first.scannedValue }))]);
    expect(results.map((r) => r.body.resultState).sort()).toEqual(["MATCHED_EXISTING", "NEW_DRAFT"]);
    expect(results[0]!.body.matchedSkuId).toBe(results[1]!.body.matchedSkuId);
    const [draft] = await db.select().from(skus).where(eq(skus.id, results[0]!.body.matchedSkuId!));
    expect(draft).toMatchObject({ lifecycleState: "INTAKE", identityConfidence: "LOW", canonicalSlug: null });
  });
  it("records a collision for manual identification without creating or choosing a SKU", async () => {
    const scan = input();
    for (let i = 0; i < 2; i++) {
      const draft = await createSkuDraft(db, { userId: admin.userId }, {});
      await attachSkuIdentifier(db, { userId: admin.userId }, { skuId: draft.id, identifierType: "SUPPLIER_CODE", value: scan.scannedValue });
    }
    const result = await receiveIntake(db, admin, scan);
    expect(result.body).toMatchObject({ resultState: "MANUAL_IDENTIFICATION_REQUIRED", matchedSkuId: null });
    expect(await db.select().from(skuIdentifiers).where(eq(skuIdentifiers.value, scan.scannedValue))).toHaveLength(2);
  });
  it("ignores archived external matches and resolves internal Code128 and QR labels directly", async () => {
    const scan = input();
    const draft = await createSkuDraft(db, { userId: admin.userId }, {});
    await attachSkuIdentifier(db, { userId: admin.userId }, { skuId: draft.id, identifierType: "SUPPLIER_CODE", value: scan.scannedValue });
    const byCode = await receiveIntake(db, admin, input({ scannedValue: draft.internalSku }));
    const byQr = await receiveIntake(db, admin, input({ scannedValue: `khidi://sku/${draft.internalSku}` }));
    expect(byCode.body.matchedSkuId).toBe(draft.id);
    expect(byQr.body.matchedSkuId).toBe(draft.id);
    await transitionSkuLifecycle(db, { userId: admin.userId }, draft.id, "ARCHIVED");
    const result = await receiveIntake(db, admin, scan);
    expect(result.body.resultState).toBe("NEW_DRAFT");
    expect(result.body.matchedSkuId).not.toBe(draft.id);
    expect((await receiveIntake(db, admin, input({ scannedValue: draft.internalSku }))).body).toMatchObject({ reviewReason: "ARCHIVED_INTERNAL_LABEL", matchedSkuId: null });
  });
  it("checks owner, assignment, device and Quick Scan permission before accepting an intake", async () => {
    await expect(receiveIntake(db, warehouse, input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(receiveIntake(db, warehouse, input({ userId: warehouse.userId }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const assigned = await task();
    const accepted = await receiveIntake(db, warehouse, input({ userId: warehouse.userId, sourceMode: "TASK", taskId: assigned.id }));
    expect(accepted.status).toBe(201);
    await db.update(scanTasks).set({ assigneeRole: null, assigneeUserId: admin.userId }).where(eq(scanTasks.id, assigned.id));
    expect((await receiveIntake(db, warehouse, input({ userId: warehouse.userId, sourceMode: "TASK", taskId: assigned.id }))).body.reviewReason).toBe("TASK_NOT_ASSIGNED");
    await expect(receiveIntake(db, { ...warehouse, authMethod: "WAREHOUSE_PIN", deviceId: key() }, input({ userId: warehouse.userId, sourceMode: "TASK", taskId: assigned.id }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(receiveIntake(db, { ...warehouse, role: "ADMIN" }, input({ userId: warehouse.userId }))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

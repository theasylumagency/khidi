import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadPrincipalByUserId, type AuthenticatedPrincipal } from "@khidi/auth";
import { getDb, labelEvents, productIntakes, scanTasks, skus, users } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import { getPrintableLabels, listLabelsToPrint, markLabelsPrinted, receiveIntake } from "./index.ts";

describe("M3 S3 no-barcode and label lifecycle", () => {
  const db = getDb();
  let admin: AuthenticatedPrincipal, warehouse: AuthenticatedPrincipal;
  beforeAll(async () => {
    const [a] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
    const [w] = await db.select().from(users).where(eq(users.role, "WAREHOUSE")).limit(1);
    admin = await loadPrincipalByUserId(db, a!.id);
    warehouse = await loadPrincipalByUserId(db, w!.id);
  });
  it("creates an immediate neutral SKU, prints once and confirms attachment only by scanning its label", async () => {
    const [task] = await db.insert(scanTasks).values({ id: createUuidV7(), title: "Labels", taskType: "INTAKE_UNIQUE", assigneeRole: "WAREHOUSE", targetCount: 3, createdBy: admin.userId }).returning();
    const input = { idempotencyKey: createUuidV7(), userId: warehouse.userId, deviceId: createUuidV7(), scannedAt: new Date().toISOString(), sourceMode: "TASK", taskId: task!.id, isNoBarcode: true };
    const accepted = await receiveIntake(db, warehouse, input);
    const [sku] = await db.select().from(skus).where(eq(skus.id, accepted.body.matchedSkuId!));
    expect(sku!.internalSku).toMatch(/^KH-\d{6,}$/);
    expect(accepted.body.labelStatus).toBe("TO_PRINT");
    expect((await listLabelsToPrint(db, admin)).some((row) => row.intake.id === accepted.body.id)).toBe(true);
    const print = { intakeIds: [accepted.body.id], idempotencyKey: createUuidV7() };
    expect(await getPrintableLabels(db, admin, print.intakeIds)).toContain(sku!.internalSku);
    const [first, replay] = await Promise.all([markLabelsPrinted(db, admin, print), markLabelsPrinted(db, admin, print)]);
    expect(first.body).toEqual(replay.body);
    let [row] = await db.select().from(productIntakes).where(eq(productIntakes.id, accepted.body.id));
    expect(row!.labelStatus).toBe("PRINTED");
    expect((await receiveIntake(db, warehouse, input)).body).toEqual(accepted.body);
    const attached = await receiveIntake(db, warehouse, { ...input, idempotencyKey: createUuidV7(), isNoBarcode: false, scannedValue: `khidi://sku/${sku!.internalSku}` });
    expect(attached.body).toMatchObject({ matchedSkuId: sku!.id, duplicateOfIntakeId: accepted.body.id, resultState: "MATCHED_EXISTING" });
    [row] = await db.select().from(productIntakes).where(eq(productIntakes.id, accepted.body.id));
    expect(row!.labelStatus).toBe("ATTACHED");
    const history = await db.select().from(labelEvents).where(eq(labelEvents.intakeId, row!.id));
    expect(history.map((event) => event.toStatus).sort()).toEqual(["ATTACHED", "PRINTED", "TO_PRINT"]);
    await expect(db.insert(labelEvents).values({ id: createUuidV7(), intakeId: row!.id, fromStatus: null, toStatus: "ATTACHED", actorUserId: admin.userId })).rejects.toThrow();
    const [progress] = await db.select().from(scanTasks).where(eq(scanTasks.id, task!.id));
    expect(progress!.completedCount).toBe(1);
    await expect(db.update(labelEvents).set({ toStatus: "TO_PRINT" }).where(eq(labelEvents.intakeId, row!.id))).rejects.toThrow();
    await expect(markLabelsPrinted(db, warehouse, print)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listLabelsToPrint(db, warehouse)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps a failed batch atomic and never treats an unprinted label as attached", async () => {
    const input = { idempotencyKey: createUuidV7(), userId: admin.userId, deviceId: createUuidV7(), scannedAt: new Date().toISOString(), sourceMode: "QUICK_SCAN", isNoBarcode: true };
    const accepted = await receiveIntake(db, admin, input);
    const [sku] = await db.select().from(skus).where(eq(skus.id, accepted.body.matchedSkuId!));
    await receiveIntake(db, admin, { ...input, idempotencyKey: createUuidV7(), isNoBarcode: false, scannedValue: sku!.internalSku });
    await expect(markLabelsPrinted(db, admin, { intakeIds: [accepted.body.id, createUuidV7()], idempotencyKey: createUuidV7() })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [row] = await db.select().from(productIntakes).where(eq(productIntakes.id, accepted.body.id));
    expect(row!.labelStatus).toBe("TO_PRINT");
  });
});

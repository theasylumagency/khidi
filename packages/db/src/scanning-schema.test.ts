import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createUuidV7 } from "@khidi/shared";
import { getDb, productIntakes, scanTasks, users } from "./index.ts";

describe("M3 S1 scanning schema", () => {
  const db = getDb();
  it("grants reads and writes but prevents deleting intake/task history and mutating label history", async () => {
    for (const table of ["scan_tasks", "product_intakes", "label_events"]) {
      const result = await db.execute(sql`SELECT
        has_table_privilege(current_user, ${table}, 'SELECT') AS can_read,
        has_table_privilege(current_user, ${table}, 'INSERT') AS can_insert,
        has_table_privilege(current_user, ${table}, 'DELETE') AS can_delete,
        has_table_privilege(current_user, ${table}, 'UPDATE') AS can_update`);
      expect(result.rows[0]).toEqual({ can_read: true, can_insert: true, can_delete: false, can_update: table !== "label_events" });
    }
  });
  it("enforces assignment, positive targets, source/task consistency and durable idempotency in PostgreSQL", async () => {
    const [admin] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
    const task = { id: createUuidV7(), taskType: "INTAKE_UNIQUE", title: "Schema test", createdBy: admin!.id };
    await expect(db.insert(scanTasks).values(task)).rejects.toThrow();
    await expect(db.insert(scanTasks).values({ ...task, assigneeRole: "WAREHOUSE", targetCount: 0 })).rejects.toThrow();
    await db.insert(scanTasks).values({ ...task, assigneeRole: "WAREHOUSE", targetCount: 10 });
    const intake = {
      id: createUuidV7(), sourceMode: "QUICK_SCAN", scannedBy: admin!.id,
      clientDeviceId: createUuidV7(), isNoBarcode: true, resultState: "PROCESSING",
      idempotencyKey: createUuidV7(), requestHash: "test", scannedAt: new Date(), acceptanceResponseJson: {}
    };
    await expect(db.insert(productIntakes).values({ ...intake, taskId: task.id })).rejects.toThrow();
    await db.insert(productIntakes).values(intake);
    await expect(db.insert(productIntakes).values({ ...intake, id: createUuidV7() })).rejects.toThrow();
    await expect(db.delete(productIntakes).where(eq(productIntakes.id, intake.id))).rejects.toThrow();
    await expect(db.delete(scanTasks).where(eq(scanTasks.id, task.id))).rejects.toThrow();
  });
});

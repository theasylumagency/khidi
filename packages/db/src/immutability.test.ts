import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createUuidV7 } from "@agrotrade/shared";
import { getDb, auditLogs, outboxEvents } from "./index.ts";
import { runMigrations } from "./migrate.ts";
import { runSeed } from "./seed.ts";

describe("@agrotrade/db — Append-Only Immutability & Role Separation [C7]", () => {
  beforeAll(async () => {
    await runMigrations();
    await runSeed();
  });

  it("allows INSERT on audit_logs from hub_app role but rejects UPDATE and DELETE [C7]", async () => {
    const db = getDb();
    const auditId = createUuidV7();

    await db.insert(auditLogs).values({
      id: auditId,
      action: "TEST_IMMUTABILITY",
      entityType: "test_entity",
      entityId: "1",
      correlationId: "cor_test_c7"
    });

    await expect(
      db.execute(sql`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = ${auditId}`)
    ).rejects.toThrow();

    await expect(
      db.execute(sql`DELETE FROM audit_logs WHERE id = ${auditId}`)
    ).rejects.toThrow();
  });

  it("allows INSERT on outbox_events from hub_app role but rejects UPDATE and DELETE [C7, C10]", async () => {
    const db = getDb();
    const eventId = createUuidV7();
    const aggregateId = createUuidV7();

    await db.insert(outboxEvents).values({
      id: eventId,
      eventType: "PRODUCT_UPDATED",
      aggregateType: "sku",
      aggregateId,
      payloadJson: { test: true },
      correlationId: "cor_test_c10"
    });

    await expect(
      db.execute(sql`UPDATE outbox_events SET event_type = 'TAMPERED' WHERE id = ${eventId}`)
    ).rejects.toThrow();

    await expect(
      db.execute(sql`DELETE FROM outbox_events WHERE id = ${eventId}`)
    ).rejects.toThrow();
  });
});

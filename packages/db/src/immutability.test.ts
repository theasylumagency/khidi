import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { createUuidV7 } from "@khidi/shared";
import {
  getDb,
  auditLogs,
  outboxEvents,
  runMigrations,
  resolveAppDatabaseUrl,
  resolveMigratorDatabaseUrl
} from "./index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Database Foundation: Role Separation, Migration Runner & Append-Only Immutability ([C7, C10])", () => {
  const db = getDb();
  let testAuditId: string;
  let testOutboxId: string;

  beforeAll(async () => {
    testAuditId = createUuidV7();
    await db.insert(auditLogs).values({
      id: testAuditId,
      action: "TEST_IMMUTABILITY_INSERT",
      entityType: "test_entity",
      entityId: "test_1",
      afterJson: { verified: true },
      correlationId: `cor_${testAuditId}`
    });

    testOutboxId = createUuidV7();
    await db.insert(outboxEvents).values({
      id: testOutboxId,
      eventType: "PRODUCT_UPDATED",
      aggregateType: "product",
      aggregateId: createUuidV7(),
      payloadJson: { skuCode: "TEST-SKU" },
      correlationId: `cor_${testOutboxId}`
    });
  });

  it("blocks UPDATE and DELETE on audit_logs when connected as hub_app role ([C7])", async () => {
    await expect(
      db
        .update(auditLogs)
        .set({ action: "TAMPERED_ACTION" })
        .where(eq(auditLogs.id, testAuditId))
    ).rejects.toThrow();

    await expect(
      db.delete(auditLogs).where(eq(auditLogs.id, testAuditId))
    ).rejects.toThrow();

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.id, testAuditId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("TEST_IMMUTABILITY_INSERT");
  });

  it("blocks UPDATE and DELETE on outbox_events when connected as hub_app role ([C7, C10])", async () => {
    await expect(
      db
        .update(outboxEvents)
        .set({ eventType: "TAMPERED_EVENT" })
        .where(eq(outboxEvents.id, testOutboxId))
    ).rejects.toThrow();

    await expect(
      db.delete(outboxEvents).where(eq(outboxEvents.id, testOutboxId))
    ).rejects.toThrow();

    const rows = await db.select().from(outboxEvents).where(eq(outboxEvents.id, testOutboxId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe("PRODUCT_UPDATED");
  });

  it("does not create roles or embed passwords in 0001_foundation.sql", () => {
    const sqlPath = join(__dirname, "..", "migrations", "0001_foundation.sql");
    const sqlContent = readFileSync(sqlPath, "utf8");
    expect(sqlContent).not.toMatch(/CREATE\s+ROLE\s+hub_app/i);
    expect(sqlContent).not.toContain("hub_app_dev_password");
  });

  it("skips already-applied migrations and serializes concurrent runs with pg_advisory_lock", async () => {
    const [runA, runB] = await Promise.all([runMigrations(), runMigrations()]);
    expect(runA.applied).toEqual([]);
    expect(runA.skipped).toContain("0001_foundation.sql");
    expect(runB.applied).toEqual([]);
    expect(runB.skipped).toContain("0001_foundation.sql");
  });

  it("fails fast in NODE_ENV=production if DATABASE_URL or DATABASE_MIGRATOR_URL is missing or uses dev passwords", () => {
    expect(() => resolveAppDatabaseUrl({ NODE_ENV: "production" })).toThrow(
      /CRITICAL: DATABASE_URL/
    );
    expect(() =>
      resolveAppDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://hub_app:hub_app_dev_password@localhost:5435/agrotrade_hub"
      })
    ).toThrow(/CRITICAL: DATABASE_URL/);

    expect(() => resolveMigratorDatabaseUrl({ NODE_ENV: "production" })).toThrow(
      /CRITICAL: DATABASE_MIGRATOR_URL/
    );
    expect(() =>
      resolveMigratorDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_MIGRATOR_URL:
          "postgresql://hub_migrator:hub_migrator_dev_password@localhost:5435/agrotrade_hub"
      })
    ).toThrow(/CRITICAL: DATABASE_MIGRATOR_URL/);

    expect(
      resolveAppDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://hub_app:s3cr3t_prod_pw@db.internal:5432/khidi_hub"
      })
    ).toBe("postgresql://hub_app:s3cr3t_prod_pw@db.internal:5432/khidi_hub");
  });
});

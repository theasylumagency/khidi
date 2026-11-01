import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, auditLogs, outboxEvents, outboxDeliveries } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import {
  withDomainTransaction,
  executeIdempotent,
  createDomainTransactionContext
} from "./index.ts";

describe("Domain Transaction, Per-Consumer Outbox ([C10]) & Atomic Idempotency", () => {
  const db = getDb();

  it("commits domain state, audit_logs, outbox_events, and per-consumer outbox_deliveries in one transaction ([C10])", async () => {
    const aggregateId = createUuidV7();
    const storefrontA = `storefront:${createUuidV7()}`;
    const storefrontB = `storefront:${createUuidV7()}`;

    const result = await withDomainTransaction(db, {}, async (ctx) => {
      const auditId = await ctx.recordAudit({
        action: "TEST_DOMAIN_ACTION",
        entityType: "product",
        entityId: aggregateId,
        after: { status: "READY" }
      });

      const outbox = await ctx.emitOutboxEvent({
        eventType: "PRODUCT_APPROVED",
        aggregateType: "product",
        aggregateId,
        payload: { productId: aggregateId },
        consumers: [storefrontA, storefrontB, "notifications"]
      });

      return { auditId, outbox };
    });

    const savedAudit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.id, result.auditId));
    expect(savedAudit).toHaveLength(1);

    const savedEvent = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, result.outbox.eventId));
    expect(savedEvent).toHaveLength(1);

    const deliveries = await db
      .select()
      .from(outboxDeliveries)
      .where(eq(outboxDeliveries.outboxEventId, result.outbox.eventId));
    expect(deliveries).toHaveLength(3);
    expect(deliveries.map((d) => d.consumer).sort()).toEqual(
      [storefrontA, storefrontB, "notifications"].sort()
    );
    expect(deliveries.every((d) => d.status === "PENDING")).toBe(true);
  });

  it("rolls back audit and outbox rows if the domain transaction throws", async () => {
    let capturedAuditId = "";

    await expect(
      withDomainTransaction(db, {}, async (ctx) => {
        capturedAuditId = await ctx.recordAudit({
          action: "SHOULD_ROLLBACK",
          entityType: "product",
          entityId: createUuidV7()
        });
        throw new Error("Simulated domain failure");
      })
    ).rejects.toThrow("Simulated domain failure");

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.id, capturedAuditId));
    expect(rows).toHaveLength(0);
  });

  it("claims idempotency key atomically inside the handler transaction and prevents concurrent duplicate execution", async () => {
    const scope = "test:concurrent_reserve";
    const key = `idem_${createUuidV7()}`;
    let executionCount = 0;

    const runHandler = () =>
      executeIdempotent(
        db,
        { scope, idempotencyKey: key, payload: { sku: "SKU-001", qty: 2 } },
        async (tx) => {
          executionCount += 1;
          // Simulate async work inside the transaction while holding the IN_PROGRESS key claim
          await new Promise((resolve) => setTimeout(resolve, 60));
          const ctx = createDomainTransactionContext(tx, {});
          const auditId = await ctx.recordAudit({
            action: "IDEMPOTENT_RESERVE_EXECUTED",
            entityType: "reservation",
            entityId: key
          });
          return {
            status: 201,
            body: { reservationId: "res_123", qty: 2, auditId }
          };
        }
      );

    // Launch two concurrent requests with the exact same (scope, idempotencyKey)
    const [res1, res2] = await Promise.all([runHandler(), runHandler()]);

    // Handler must have executed strictly ONCE!
    expect(executionCount).toBe(1);
    expect([res1.replayed, res2.replayed].sort()).toEqual([false, true]);
    expect(res1.body.reservationId).toBe("res_123");
    expect(res2.body.reservationId).toBe("res_123");
    expect(res1.body.auditId).toBe(res2.body.auditId);

    // Different payload with the same idempotency key must throw IDEMPOTENCY_CONFLICT
    await expect(
      executeIdempotent(
        db,
        { scope, idempotencyKey: key, payload: { sku: "SKU-001", qty: 99 } },
        async () => ({
          status: 201,
          body: { reservationId: "res_999", qty: 99 }
        })
      )
    ).rejects.toThrow(/different payload/);
  });

  it("rolls back the IN_PROGRESS idempotency key claim if the handler fails, allowing a clean retry", async () => {
    const scope = "test:rollback_retry";
    const key = `idem_${createUuidV7()}`;
    let attempts = 0;

    await expect(
      executeIdempotent(
        db,
        { scope, idempotencyKey: key, payload: { qty: 5 } },
        async () => {
          attempts += 1;
          throw new Error("Transient failure inside handler");
        }
      )
    ).rejects.toThrow("Transient failure inside handler");

    const retryResult = await executeIdempotent(
      db,
      { scope, idempotencyKey: key, payload: { qty: 5 } },
      async () => {
        attempts += 1;
        return { status: 200, body: { ok: true } };
      }
    );

    expect(attempts).toBe(2);
    expect(retryResult.replayed).toBe(false);
    expect(retryResult.body.ok).toBe(true);
  });
});

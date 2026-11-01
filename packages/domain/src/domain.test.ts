import { beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import {
  getDb,
  auditLogs,
  outboxDeliveries,
  runMigrations,
  runSeed
} from "@agrotrade/db";
import { AppError, createUuidV7 } from "@agrotrade/shared";
import { executeIdempotent, withDomainTransaction } from "./index.ts";

describe("@agrotrade/domain — Transactions, Per-Consumer Outbox [C10] & Idempotency", () => {
  beforeAll(async () => {
    await runMigrations();
    await runSeed();
  });

  it("creates one immutable outbox_event and independent outbox_deliveries per consumer [C10]", async () => {
    const db = getDb();
    const aggregateId = createUuidV7();
    const consumerA = "storefront:store-a";
    const consumerB = "storefront:store-b";

    const result = await withDomainTransaction(
      db,
      { correlationId: "cor_outbox_c10" },
      async (ctx) => {
        await ctx.recordAudit({
          action: "TEST_OUTBOX_FANOUT",
          entityType: "sku",
          entityId: aggregateId
        });

        return ctx.emitOutboxEvent({
          eventType: "PRICE_CHANGED",
          aggregateType: "sku",
          aggregateId,
          payload: { skuId: aggregateId, priceMinor: 150000 },
          consumers: [consumerA, consumerB, "notifications"]
        });
      }
    );

    expect(result.deliveryIds).toHaveLength(3);

    // Simulate consumerA failing (retry scheduled) while consumerB succeeds independently [C10]
    await db
      .update(outboxDeliveries)
      .set({ status: "DELIVERED", attempts: 1, deliveredAt: new Date() })
      .where(
        and(
          eq(outboxDeliveries.outboxEventId, result.eventId),
          eq(outboxDeliveries.consumer, consumerB)
        )
      );

    await db
      .update(outboxDeliveries)
      .set({ status: "PENDING", attempts: 2 })
      .where(
        and(
          eq(outboxDeliveries.outboxEventId, result.eventId),
          eq(outboxDeliveries.consumer, consumerA)
        )
      );

    const rows = await db
      .select()
      .from(outboxDeliveries)
      .where(eq(outboxDeliveries.outboxEventId, result.eventId));

    const rowA = rows.find((r) => r.consumer === consumerA);
    const rowB = rows.find((r) => r.consumer === consumerB);

    expect(rowA?.status).toBe("PENDING");
    expect(rowA?.attempts).toBe(2);
    expect(rowB?.status).toBe("DELIVERED");
    expect(rowB?.attempts).toBe(1);
  });

  it("rolls back audit and outbox writes atomically when the domain operation fails (§3.4)", async () => {
    const db = getDb();
    const entityId = createUuidV7();

    await expect(
      withDomainTransaction(db, { correlationId: "cor_rollback" }, async (ctx) => {
        await ctx.recordAudit({
          action: "SHOULD_ROLL_BACK",
          entityType: "test",
          entityId
        });
        throw new AppError("PRECONDITION_FAILED", "Simulated domain failure");
      })
    ).rejects.toThrow("Simulated domain failure");

    const found = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, entityId));

    expect(found).toHaveLength(0);
  });

  it("replays identical idempotent requests and rejects conflicting payloads with the same key (§3.4)", async () => {
    const db = getDb();
    const key = `idem_${createUuidV7()}`;
    let counter = 0;

    const first = await executeIdempotent(
      db,
      { scope: "test-scope", idempotencyKey: key, payload: { qty: 5 } },
      async () => {
        counter += 1;
        return { status: 201, body: { createdCount: counter } };
      }
    );

    const second = await executeIdempotent(
      db,
      { scope: "test-scope", idempotencyKey: key, payload: { qty: 5 } },
      async () => {
        counter += 1;
        return { status: 201, body: { createdCount: counter } };
      }
    );

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.body.createdCount).toBe(1);
    expect(counter).toBe(1);

    await expect(
      executeIdempotent(
        db,
        { scope: "test-scope", idempotencyKey: key, payload: { qty: 99 } },
        async () => ({ status: 201, body: { createdCount: 2 } })
      )
    ).rejects.toThrow(AppError);
  });
});

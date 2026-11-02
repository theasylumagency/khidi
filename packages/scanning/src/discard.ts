import { and, eq } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, auditLogs } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError, sha256Hex } from "@khidi/shared";
import { discardInputSchema } from "./contracts.ts";
import { assertScanningPrincipal } from "./principal.ts";

export async function reportOfflineDiscard(db: DbExecutor, principal: AuthenticatedPrincipal, raw: unknown) {
  const parsed = discardInputSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid discard report.");
  const input = parsed.data;
  if (input.userId !== principal.userId) throw new AppError("FORBIDDEN", "Only the scanner can discard their queued entry.");
  await assertScanningPrincipal(db, principal);
  const requestHash = sha256Hex(JSON.stringify(input));
  return executeIdempotent(db, { scope: "scanning:offline-discard", idempotencyKey: input.idempotencyKey, payload: input }, (tx) =>
    withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
      const [existing] = await ctx.tx.select().from(auditLogs).where(and(eq(auditLogs.action, "OFFLINE_SCAN_DISCARDED"), eq(auditLogs.entityId, input.idempotencyKey))).limit(1);
      if (existing && existing.afterJson?.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT", "Discard key already used.");
      const body = { id: input.idempotencyKey };
      if (!existing) {
        await ctx.recordAudit({ action: "OFFLINE_SCAN_DISCARDED", entityType: "offline_scan", entityId: input.idempotencyKey,
          after: { ...input, requestHash, authenticatedDeviceId: principal.deviceId }, reason: input.reason });
        await ctx.emitOutboxEvent({ eventType: "OFFLINE_SCAN_DISCARDED", aggregateType: "offline_scan", aggregateId: input.idempotencyKey, payload: { ...input }, consumers: [] });
      }
      return { status: 200, body };
    })
  );
}

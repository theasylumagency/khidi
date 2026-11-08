import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, productIntakes, skus, labelEvents } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { buildThermalLabelBatchHtml } from "@khidi/products";
import { AppError, createUuidV7 } from "@khidi/shared";
import { uuidV7Schema } from "./contracts.ts";
// Keep the principal check in its own module to avoid a scanning/labels import cycle.
import { assertScanningPrincipal } from "./principal.ts";

export async function listLabelsToPrint(db: DbExecutor, principal: AuthenticatedPrincipal) {
  await assertScanningPrincipal(db, principal, true);
  return db.select({ intake: productIntakes, sku: skus }).from(productIntakes)
    .innerJoin(skus, eq(skus.id, productIntakes.matchedSkuId))
    .where(eq(productIntakes.labelStatus, "TO_PRINT")).orderBy(asc(productIntakes.createdAt)).limit(500);
}

export const labelSelectionSchema = z.object({ intakeIds: z.array(z.string().max(36).uuid()).min(1).max(100) }).strict();
export async function getPrintableLabels(db: DbExecutor, principal: AuthenticatedPrincipal, intakeIds: string[]) {
  await assertScanningPrincipal(db, principal, true);
  const parsed = labelSelectionSchema.safeParse({ intakeIds });
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Select 1–100 valid labels.");
  const uniqueIds = [...new Set(intakeIds)];
  const rows = await db.select({ intake: productIntakes, sku: skus }).from(productIntakes)
    .innerJoin(skus, eq(skus.id, productIntakes.matchedSkuId))
    .where(and(inArray(productIntakes.id, uniqueIds), inArray(productIntakes.labelStatus, ["TO_PRINT", "PRINTED"])))
    .orderBy(asc(productIntakes.id));
  if (rows.length !== uniqueIds.length) throw new AppError("PRECONDITION_FAILED", "Some labels are unavailable for printing.");
  return buildThermalLabelBatchHtml(rows.map(({ sku }) => ({ internalSku: sku.internalSku,
    qrValue: `khidi://sku/${sku.internalSku}`, titleKa: sku.displayNameKa ?? sku.internalSku, brand: sku.brand, modelCode: sku.modelCode })));
}

export async function markLabelsPrinted(db: DbExecutor, principal: AuthenticatedPrincipal, raw: unknown) {
  await assertScanningPrincipal(db, principal, true);
  const parsed = labelSelectionSchema.extend({ idempotencyKey: uuidV7Schema }).safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid label batch.");
  const input = { ...parsed.data, intakeIds: [...new Set(parsed.data.intakeIds)].sort(), userId: principal.userId };
  return executeIdempotent(db, { scope: "scanning:labels:printed", idempotencyKey: input.idempotencyKey, payload: input }, (tx) =>
    withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
      const rows = await ctx.tx.select().from(productIntakes).where(inArray(productIntakes.id, input.intakeIds)).orderBy(asc(productIntakes.id)).for("update");
      if (rows.length !== input.intakeIds.length || rows.some((row) => !["TO_PRINT", "PRINTED"].includes(row.labelStatus))) {
        throw new AppError("PRECONDITION_FAILED", "Some labels cannot be marked printed.");
      }
      for (const row of rows) {
        if (row.labelStatus === "PRINTED") continue;
        await ctx.tx.update(productIntakes).set({ labelStatus: "PRINTED" }).where(eq(productIntakes.id, row.id));
        await ctx.tx.insert(labelEvents).values({ id: createUuidV7(), intakeId: row.id, fromStatus: "TO_PRINT", toStatus: "PRINTED", actorUserId: principal.userId });
        await ctx.recordAudit({ action: "LABEL_PRINTED", entityType: "product_intake", entityId: row.id, after: { labelStatus: "PRINTED" } });
        await ctx.emitOutboxEvent({ eventType: "LABEL_STATUS_CHANGED", aggregateType: "product_intake", aggregateId: row.id, payload: { labelStatus: "PRINTED" }, consumers: ["notifications"] });
      }
      return { status: 200, body: { intakeIds: input.intakeIds } };
    })
  );
}

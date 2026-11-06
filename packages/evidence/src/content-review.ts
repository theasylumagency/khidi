import { eq } from "drizzle-orm";
import { skuContentApprovals, skuContentVersions, skuFieldProvenance, skus, type DbExecutor, type EvidenceValue } from "@khidi/db";
import type { DomainTransactionContext } from "@khidi/domain";

type Fact = { status: string; value: EvidenceValue | null };
type FactMap = ReadonlyMap<string, Fact>;

export function getApprovedContent(db: DbExecutor, skuId: string) {
  return db.select({ version: skuContentVersions, approvedAt: skuContentApprovals.approvedAt, approvedBy: skuContentApprovals.approvedBy })
    .from(skuContentApprovals).innerJoin(skuContentVersions, eq(skuContentApprovals.versionId, skuContentVersions.id))
    .where(eq(skuContentApprovals.skuId, skuId));
}

export async function getContentFactFields(db: DbExecutor, skuId: string) {
  const rows = await db.select().from(skuFieldProvenance).where(eq(skuFieldProvenance.skuId, skuId));
  return new Map(rows.map((row) => [row.fieldName, row]));
}

export function compareApprovedContentFacts(snapshot: Record<string, EvidenceValue>, fields: FactMap) {
  const changedFields: string[] = [];
  const conflictingFields: string[] = [];
  for (const [name, value] of Object.entries(snapshot)) {
    const field = fields.get(name);
    if (field?.status !== "VERIFIED" || field.value !== value) changedFields.push(name);
    if (field?.status === "CONFLICT") conflictingFields.push(name);
  }
  return { changedFields, conflictingFields };
}

export async function refreshSkuContentReview(ctx: DomainTransactionContext, skuId: string, previousFields?: FactMap) {
  const [[sku], approvals, fields] = await Promise.all([
    ctx.tx.select({ state: skus.lifecycleState, flagged: skus.contentReviewRequired }).from(skus).where(eq(skus.id, skuId)),
    getApprovedContent(ctx.tx, skuId),
    getContentFactFields(ctx.tx, skuId)
  ]);
  if (!sku) return;
  const missingKa = sku.state === "READY" && !approvals.some(({ version }) => version.locale === "ka");
  const stale = approvals.flatMap(({ version }) => {
    const { changedFields, conflictingFields } = compareApprovedContentFacts(version.verifiedFacts, fields);
    if (!changedFields.length) return [];
    return [{ locale: version.locale, changedFields, conflictingFields }];
  });
  const required = missingKa || stale.length > 0;
  if (sku.flagged !== required) {
    await ctx.tx.update(skus).set({ contentReviewRequired: required }).where(eq(skus.id, skuId));
    await ctx.recordAudit({ action: "CANONICAL_CONTENT_REVIEW_CHANGED", entityType: "sku", entityId: skuId,
      before: { contentReviewRequired: sku.flagged }, after: { contentReviewRequired: required, missingKa, stale } });
  }
  const newlyChanged = previousFields && stale.some(({ changedFields }) => changedFields.some((name) => {
    const before = previousFields.get(name), after = fields.get(name);
    return before?.status !== after?.status || before?.value !== after?.value;
  }));
  if (required && (!sku.flagged || newlyChanged)) {
    if (sku.flagged) await ctx.recordAudit({ action: "CANONICAL_CONTENT_FACT_CHANGED", entityType: "sku", entityId: skuId, after: { stale } });
    await ctx.emitOutboxEvent({ eventType: "PRODUCT_REVIEW_REQUIRED", aggregateType: "sku", aggregateId: skuId,
      payload: { skuId, severity: "ACTION_REQUIRED", reason: missingKa ? "CONTENT_APPROVAL_REQUIRED" : "CONTENT_FACT_CHANGED",
        locales: [...new Set([...(missingKa ? ["ka"] : []), ...stale.map((row) => row.locale)])], stale }, consumers: ["notifications"] });
  } else if (sku.flagged && !required) {
    await ctx.emitOutboxEvent({ eventType: "PRODUCT_UPDATED", aggregateType: "sku", aggregateId: skuId,
      payload: { skuId, contentReviewRequired: false }, consumers: [] });
  }
}

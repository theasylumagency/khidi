import { eq, inArray } from "drizzle-orm";
import { productImages, productIntakes, skuMergeAcknowledgements, skuFieldProvenance, skus, type evidence } from "@khidi/db";
import type { DomainTransactionContext } from "@khidi/domain";
import { evidenceValuesDiffer, resolveEvidenceField, type ResolvedField } from "./rules.ts";
export type EvidenceSource = typeof evidence.$inferSelect & {
    claimSkuId?: string;
};
export async function applyMergeUncertainty(ctx: DomainTransactionContext, skuId: string, lineage: string[], items: EvidenceSource[], fields: Map<string, ResolvedField>, decisions: Map<string, typeof skuFieldProvenance.$inferSelect>) {
    const records = await ctx.tx.select().from(skuMergeAcknowledgements).where(inArray(skuMergeAcknowledgements.targetSkuId, lineage));
    if (!records.length)
        return { conflict: false };
    const sideDecisions = await ctx.tx.select().from(skuFieldProvenance).where(inArray(skuFieldProvenance.skuId, [...new Set(records.flatMap((record) => [...record.sourceLineageIds, ...record.targetLineageIds]))]));
    const [intakes, images, [sku]] = await Promise.all([
        ctx.tx.select({ id: productIntakes.id, scannedSkuId: productIntakes.scannedSkuId }).from(productIntakes)
            .where(inArray(productIntakes.id, items.flatMap((item) => item.intakeId ? [item.intakeId] : []))),
        ctx.tx.select({ id: productImages.id, intakeId: productImages.intakeId }).from(productImages)
            .where(inArray(productImages.id, items.flatMap((item) => item.imageId ? [item.imageId] : []))),
        ctx.tx.select({ flagged: skus.mergedUndeterminedFields, conflicts: skus.mergeConflictFields }).from(skus).where(eq(skus.id, skuId))
    ]);
    const photoIntakeIds = images.flatMap((image) => image.intakeId ? [image.intakeId] : []);
    if (photoIntakeIds.length)
        intakes.push(...await ctx.tx.select({ id: productIntakes.id, scannedSkuId: productIntakes.scannedSkuId })
            .from(productIntakes).where(inArray(productIntakes.id, photoIntakeIds)));
    const intakeSide = new Map(intakes.map((intake) => [intake.id, intake.scannedSkuId]));
    const photoIntakes = new Map(images.map((image) => [image.id, image.intakeId]));
    const origin = (item: EvidenceSource, sides: string[]) => {
        const intake = item.intakeId ?? (item.imageId ? photoIntakes.get(item.imageId) : undefined);
        const scanned = intake ? intakeSide.get(intake) : undefined;
        return scanned && sides.includes(scanned) ? scanned : item.claimSkuId ?? item.skuId;
    };
    const unresolved = new Set<string>();
    const conflictFields = new Set<string>();
    let conflict = false;
    for (const record of records) {
        const sides = [...record.sourceLineageIds, ...record.targetLineageIds];
        const sideField = (ids: string[]) => {
            const sources = items.filter((item) => ids.includes(origin(item, sides)));
            const confirmation = sideDecisions.find((decision) => decision.fieldName === record.fieldName
                && sources.some((item) => item.id === decision.confirmedEvidenceId));
            return resolveEvidenceField(record.fieldName, sources, confirmation);
        };
        const source = sideField(record.sourceLineageIds);
        const target = sideField(record.targetLineageIds);
        const leftVerified = source.status === "VERIFIED";
        const rightVerified = target.status === "VERIFIED";
        const determined = (!record.sourceUnknown || leftVerified) && (!record.targetUnknown || rightVerified)
            && leftVerified && rightVerified && !evidenceValuesDiffer(source.value!, target.value!)
            && (record.expectedValue === null || !evidenceValuesDiffer(source.value!, record.expectedValue));
        const disputed = source.status === "CONFLICT" || target.status === "CONFLICT"
            || (leftVerified && rightVerified && evidenceValuesDiffer(source.value!, target.value!))
            || (record.expectedValue !== null && ((record.sourceUnknown && leftVerified && evidenceValuesDiffer(source.value!, record.expectedValue))
                || (record.targetUnknown && rightVerified && evidenceValuesDiffer(target.value!, record.expectedValue))));
        if (disputed) {
            conflictFields.add(record.fieldName);
            fields.set(record.fieldName, { status: "CONFLICT", value: null, strong: false,
                evidenceIds: [...new Set([...source.evidenceIds, ...target.evidenceIds])] });
            conflict = true;
        }
        if (!determined)
            unresolved.add(record.fieldName);
    }
    const nextConflicts = [...conflictFields].sort();
    if (JSON.stringify(sku?.conflicts) !== JSON.stringify(nextConflicts)) {
        await ctx.tx.update(skus).set({ mergeConflictFields: nextConflicts }).where(eq(skus.id, skuId));
        await ctx.recordAudit({ action: "MERGE_EVIDENCE_CONFLICT_CHANGED", entityType: "sku", entityId: skuId,
            before: { fields: sku?.conflicts ?? [] }, after: { fields: nextConflicts } });
        if (nextConflicts.some((field) => !sku?.conflicts.includes(field)))
            await ctx.emitOutboxEvent({
                eventType: "PRODUCT_REVIEW_REQUIRED", aggregateType: "sku", aggregateId: skuId,
                payload: { skuId, fields: nextConflicts, severity: "ACTION_REQUIRED", reason: "MERGE_EVIDENCE_CONFLICT" }, consumers: ["notifications"]
            });
    }
    for (const field of unresolved) {
        const current = fields.get(field);
        if (current?.status !== "CONFLICT")
            fields.set(field, { status: "NOT_FOUND", value: null, strong: false, evidenceIds: current?.evidenceIds ?? [] });
        const previous = decisions.get(field);
        decisions.set(field, { skuId, fieldName: field, status: "NOT_FOUND", value: null, evidenceIds: [],
            confirmedEvidenceId: null, decidedBy: null, decidedAt: null, ...previous,
            notDeterminableReason: previous?.notDeterminableReason ?? "MERGE_ACKNOWLEDGED_UNKNOWN" });
    }
    const next = [...unresolved].sort();
    if (JSON.stringify(sku?.flagged) !== JSON.stringify(next)) {
        await ctx.tx.update(skus).set({ mergedUndeterminedFields: next }).where(eq(skus.id, skuId));
        await ctx.recordAudit({ action: "MERGE_UNDETERMINED_FIELDS_CHANGED", entityType: "sku", entityId: skuId,
            before: { fields: sku?.flagged ?? [] }, after: { fields: next } });
        await ctx.emitOutboxEvent({ eventType: next.length ? "PRODUCT_REVIEW_REQUIRED" : "PRODUCT_UPDATED",
            aggregateType: "sku", aggregateId: skuId, payload: { skuId, fields: next, severity: "ACTION_REQUIRED", reason: "MERGE_UNDETERMINED" },
            consumers: next.length ? ["notifications"] : [] });
    }
    return { conflict };
}

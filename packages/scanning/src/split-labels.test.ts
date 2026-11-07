import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { loadPrincipalByUserId } from "@khidi/auth";
import { auditLogs, getDb, skus } from "@khidi/db";
import { createSkuDraft, getProductTypeByKey } from "@khidi/products";
import { splitSku } from "../../products/src/corrections.ts";
import { classifySkuProductType, submitSkuEvidence } from "@khidi/evidence";
import { createUuidV7 } from "@khidi/shared";
import { getIntakeReview, listSplitLabelProgress, markLabelsPrinted, receiveIntake, resolveIntakeReview } from "./index.ts";
it("reviews split labels, including merge predecessors, queues replacements and preserves original intake history", async () => {
    const db = getDb();
    const admin = (await db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "ADMIN") }))!;
    const principal = await loadPrincipalByUserId(db, admin.id);
    const actor = { userId: admin.id };
    const scan = (scannedValue = "", isNoBarcode = false) => receiveIntake(db, principal, {
        userId: admin.id, deviceId: createUuidV7(), idempotencyKey: createUuidV7(), scannedAt: new Date().toISOString(),
        sourceMode: "QUICK_SCAN", taskId: null, scannedValue, isNoBarcode
    });
    const original = await scan("", true);
    const source = (await db.query.skus.findFirst({ where: (row, { eq }) => eq(row.id, original.body.matchedSkuId!) }))!;
    const type = await getProductTypeByKey(db, "MOTOBLOCK");
    await classifySkuProductType(db, actor, source.id, type.id, "Classify before correction");
    await markLabelsPrinted(db, principal, { idempotencyKey: createUuidV7(), intakeIds: [original.body.id] });
    const supports = await Promise.all([5.15, 6.62].map((power_kw) => submitSkuEvidence(db, actor, {
        skuId: source.id, type: "STAFF_STATEMENT", claims: { power_kw }
    })));
    const predecessor = await createSkuDraft(db, actor, { productTypeId: type.id });
    await db.update(skus).set({ lifecycleState: "ARCHIVED", mergedIntoSkuId: source.id }).where(eq(skus.id, predecessor.id));
    const split = await splitSku(db, actor, { sourceSkuId: source.id, reason: "Different carton ratings",
        targets: supports.map((item, index) => ({ claims: { power_kw: index ? 6.62 : 5.15 }, supports: { power_kw: [item.id] } })) });
    const review = await scan(source.internalSku);
    expect(review.body).toMatchObject({ reviewReason: "SPLIT_INTERNAL_LABEL", matchedSkuId: null });
    const context = await getIntakeReview(db, principal, review.body.id);
    expect(context.matches.map((candidate) => candidate.skuId).sort()).toEqual([...split.targetSkuIds].sort());
    const chained = await scan(predecessor.internalSku);
    expect(chained.body).toMatchObject({ reviewReason: "SPLIT_INTERNAL_LABEL", matchedSkuId: null });
    expect((await getIntakeReview(db, principal, chained.body.id)).intake).toMatchObject({
        scannedSkuId: predecessor.id, reviewReferenceSkuId: source.id
    });
    const target = (await db.query.skus.findFirst({ where: (row, { eq }) => eq(row.id, split.targetSkuIds[1]!) }))!;
    const resolution = await resolveIntakeReview(db, principal, { idempotencyKey: createUuidV7(),
        intakeId: review.body.id, resolution: "LINK_EXISTING", skuCode: target.internalSku, note: "Checked carton against unit" });
    expect(resolution.body).toMatchObject({ matchedSkuId: target.id, labelStatus: "TO_PRINT", resolved: true });
    expect(await db.query.productIntakes.findFirst({ where: (row, { eq }) => eq(row.id, original.body.id) }))
        .toMatchObject({ matchedSkuId: source.id, labelStatus: "PRINTED" });
    expect((await listSplitLabelProgress(db, principal)).find((row) => row.sourceSkuId === source.id))
        .toMatchObject({ printed: 1, resolved: 1 });
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, review.body.id), eq(auditLogs.action, "INTAKE_REVIEW_RESOLVED"))))
        .toHaveLength(1);
});

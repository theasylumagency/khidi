import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { loadPrincipalByUserId } from "../../auth/src/index.ts";
import { auditLogs, getDb, outboxEvents, skuMergeAcknowledgements, skus } from "@khidi/db";
import { decideSkuEvidenceField, getStorefrontIdentityFacts, reviewSkuEvidence, submitSkuEvidence } from "@khidi/evidence";
import { createUuidV7 } from "@khidi/shared";
import { receiveIntake } from "../../scanning/src/index.ts";
import { attachSkuIdentifier, createSkuDraft, getProductTypeByKey, mergeSkus, upsertProductType } from "./index.ts";
import { makeSamenessFixture } from "./sameness.test-fixture.ts";
const db = getDb();
async function fixture(known = true) {
    const admin = (await db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "ADMIN") }))!;
    const actor = { userId: admin.id };
    const template = await getProductTypeByKey(db, "MOTOBLOCK");
    const type = await upsertProductType(db, actor, { ...template, key: "MERGE_" + createUuidV7().slice(-9),
        distinguishingAttributes: ["wheel_type", "power_kw"] });
    const source = await createSkuDraft(db, actor, { productTypeId: type.id });
    const target = await createSkuDraft(db, actor, { productTypeId: type.id });
    async function proof(skuId: string, claims: Record<string, string | number>, accept = true, intakeId?: string) {
        const item = await submitSkuEvidence(db, actor, { skuId, type: "FACTORY_SPEC_SHEET", claims, intakeId });
        if (accept)
            await reviewSkuEvidence(db, actor, { evidenceId: item.id, status: "ACCEPTED", claims, reason: "Checked fixture specification" });
        return item;
    }
    if (known)
        await proof(target.id, { power_kw: 5.15 });
    const merge = (id?: string) => mergeSkus(db, actor, { sourceSkuId: source.id, targetSkuId: target.id, samenessEvidenceId: id,
        identityConfirmed: true, reason: "Inspected the same variant on both units" });
    const inspection = (unknowns: Record<string, string> = { power_kw: "No rating on the source unit" }, accept = true) => makeSamenessFixture(db, actor, source.id, target.id, { claims: { wheel_type: "RUBBER" }, unknowns, accept });
    return { admin, actor, source, target, proof, merge, inspection };
}
it("requires accepted physical sameness, not a barcode, staff statement, pending record or photo similarity", async () => {
    const f = await fixture();
    const barcode = "shared-" + createUuidV7();
    for (const sku of [f.source, f.target])
        await attachSkuIdentifier(db, f.actor, { skuId: sku.id, identifierType: "SUPPLIER_CODE", value: barcode });
    const staff = await submitSkuEvidence(db, f.actor, { skuId: f.source.id, type: "STAFF_STATEMENT", claims: { model_code: "178FE" } });
    await expect(f.merge()).rejects.toThrow(/sameness inspection/);
    await expect(f.merge(staff.id)).rejects.toThrow(/sameness inspection/);
    const pending = await f.inspection({}, false);
    await expect(f.merge(pending.id)).rejects.toThrow(/sameness inspection/);
    await reviewSkuEvidence(db, f.actor, { evidenceId: pending.id, status: "ACCEPTED", claims: pending.claims, reason: "Checked both wheels" });
    await expect(f.merge(pending.id)).rejects.toThrow(/acknowledge/);
});
it("keeps acknowledged power unpublished even when the other side provides further matching evidence", async () => {
    const f = await fixture();
    const item = await f.inspection();
    await f.merge(item.id);
    expect(await db.query.skus.findFirst({ where: (row, { eq }) => eq(row.id, f.target.id) }))
        .toMatchObject({ mergedUndeterminedFields: ["power_kw"] });
    expect((await getStorefrontIdentityFacts(db, f.target.id)).fields).not.toHaveProperty("power_kw");
    await f.proof(f.target.id, { power_kw: 5.15 });
    expect((await getStorefrontIdentityFacts(db, f.target.id)).fields).not.toHaveProperty("power_kw");
    const [record] = await db.select().from(skuMergeAcknowledgements).where(eq(skuMergeAcknowledgements.sourceSkuId, f.source.id));
    expect(record).toMatchObject({ sourceUnknown: true, targetUnknown: false, sourceLineageIds: [f.source.id], expectedValue: 5.15 });
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, f.source.id), eq(auditLogs.action, "SKU_MERGED"))))
        .toEqual([expect.objectContaining({ afterJson: expect.objectContaining({ samenessEvidenceId: item.id }) })]);
});
it("clears the flag only after the previously unknown side's original evidence becomes VERIFIED", async () => {
    const f = await fixture();
    const original = await f.proof(f.source.id, { power_kw: 5.15 }, false);
    await f.merge((await f.inspection()).id);
    await reviewSkuEvidence(db, f.actor, { evidenceId: original.id, status: "ACCEPTED", claims: original.claims, reason: "Verified the original side's sheet" });
    expect((await getStorefrontIdentityFacts(db, f.target.id)).fields.power_kw).toBe(5.15);
    expect((await db.query.skus.findFirst({ where: (row, { eq }) => eq(row.id, f.target.id) }))?.mergedUndeterminedFields).toEqual([]);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, f.target.id), eq(auditLogs.action, "MERGE_UNDETERMINED_FIELDS_CHANGED"))))
        .toContainEqual(expect.objectContaining({ afterJson: { fields: [] } }));
});
it("accepts matching evidence captured through the old label, and raises CONFLICT for a contradictory reading", async () => {
    for (const power_kw of [5.15, 6.62]) {
        const f = await fixture();
        await f.merge((await f.inspection()).id);
        const principal = await loadPrincipalByUserId(db, f.admin.id);
        const intake = await receiveIntake(db, principal, { userId: f.admin.id, deviceId: createUuidV7(), idempotencyKey: createUuidV7(),
            sourceMode: "QUICK_SCAN", taskId: null, scannedValue: f.source.internalSku, isNoBarcode: false, scannedAt: new Date().toISOString() });
        await f.proof(f.target.id, { power_kw }, true, intake.body.id);
        const result = await getStorefrontIdentityFacts(db, f.target.id);
        if (power_kw === 5.15) {
            expect(result.fields.power_kw).toBe(5.15);
            expect((await db.query.skus.findFirst({ where: (row, { eq }) => eq(row.id, f.target.id) }))?.mergedUndeterminedFields).toEqual([]);
        }
        else {
            expect(result.identityConflict).toBe(true);
            expect(result.fields).not.toHaveProperty("power_kw");
            expect(await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, f.target.id)))
                .toContainEqual(expect.objectContaining({ payloadJson: expect.objectContaining({ reason: "MERGE_EVIDENCE_CONFLICT", severity: "ACTION_REQUIRED" }) }));
        }
    }
});
it("refuses differing VERIFIED brand and model even with a sameness inspection", async () => {
    for (const field of ["brand", "model_code"]) {
        const f = await fixture();
        const item = await f.inspection();
        await f.proof(f.source.id, { [field]: field === "brand" ? "HIROMIKI" : "178FE" });
        await f.proof(f.target.id, { [field]: field === "brand" ? "OTHER BRAND" : "D178E-DF901Q" });
        await expect(f.merge(item.id)).rejects.toMatchObject({ code: "CONFLICT" });
    }
});
it("tracks an unknown survivor and two unknown sides without letting either stand in for the other", async () => {
    for (const bothUnknown of [false, true]) {
        const f = await fixture(false);
        if (!bothUnknown)
            await f.proof(f.source.id, { power_kw: 5.15 });
        await f.merge((await f.inspection()).id);
        const [record] = await db.select().from(skuMergeAcknowledgements).where(eq(skuMergeAcknowledgements.sourceSkuId, f.source.id));
        expect(record).toMatchObject({ sourceUnknown: bothUnknown, targetUnknown: true });
        await f.proof(f.target.id, { power_kw: 5.15 });
        if (bothUnknown) {
            expect((await getStorefrontIdentityFacts(db, f.target.id)).fields).not.toHaveProperty("power_kw");
            const principal = await loadPrincipalByUserId(db, f.admin.id);
            const intake = await receiveIntake(db, principal, { userId: f.admin.id, deviceId: createUuidV7(), idempotencyKey: createUuidV7(),
                sourceMode: "QUICK_SCAN", taskId: null, scannedValue: f.source.internalSku, isNoBarcode: false, scannedAt: new Date().toISOString() });
            await f.proof(f.target.id, { power_kw: 5.15 }, true, intake.body.id);
        }
        expect((await getStorefrontIdentityFacts(db, f.target.id)).fields.power_kw).toBe(5.15);
    }
});

it("honors explicit field confirmation of Medium evidence from the unknown side after merging",async()=>{
    const f=await fixture();
    const item=await submitSkuEvidence(db,f.actor,{skuId:f.source.id,type:"PACKAGING_PHOTO",claims:{power_kw:5.15}});
    await reviewSkuEvidence(db,f.actor,{evidenceId:item.id,status:"ACCEPTED",claims:item.claims,reason:"Read the original unit's carton"});
    await f.merge((await f.inspection()).id);
    expect((await getStorefrontIdentityFacts(db,f.target.id)).fields).not.toHaveProperty("power_kw");
    await decideSkuEvidenceField(db,f.actor,{skuId:f.target.id,field:"power_kw",evidenceId:item.id,
      reason:"Explicitly confirmed the rating on the unknown side's carton"});
    expect((await getStorefrontIdentityFacts(db,f.target.id)).fields.power_kw).toBe(5.15);
    expect((await db.query.skus.findFirst({where:(row,{eq})=>eq(row.id,f.target.id)}))?.mergedUndeterminedFields).toEqual([]);
});

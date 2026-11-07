import { expect, it, vi } from "vitest";
import { loadPrincipalByUserId, webauthnConfig, type AuthenticatedPrincipal } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { submitSkuEvidence } from "@khidi/evidence";
import { createSkuDraft, getProductTypeByKey } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { POST } from "./route.ts";
const { session } = vi.hoisted(() => ({ session: { principal: null as AuthenticatedPrincipal | null } }));
vi.mock("../../../../lib/session.ts", () => ({ getCurrentPrincipal: async () => session.principal }));
it("protects catalog corrections and replays splits and attributions without duplicating audit or lineage", async () => {
    const db = getDb();
    const admin = (await db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "ADMIN") }))!;
    const warehouse = (await db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "WAREHOUSE") }))!;
    const actor = { userId: admin.id }, origin = webauthnConfig().origin;
    const type = await getProductTypeByKey(db, "MOTOBLOCK");
    const source = await createSkuDraft(db, actor, { productTypeId: type.id });
    const supports = await Promise.all([5.15, 6.62].map((power_kw) => submitSkuEvidence(db, actor, {
        skuId: source.id, type: "STAFF_STATEMENT", claims: { power_kw }
    })));
    const input = { sourceSkuId: source.id, reason: "Observed different carton ratings",
        targets: supports.map((item, index) => ({ claims: { power_kw: index ? 6.62 : 5.15 }, supports: { power_kw: [item.id] } })) };
    const key = createUuidV7();
    const request = (body: unknown, requestKey = key, requestOrigin = origin) => POST(new Request(origin + "/api/products/corrections", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey, Origin: requestOrigin }, body: JSON.stringify(body)
    }));
    expect((await request({ action: "split", input })).status).toBe(401);
    session.principal = await loadPrincipalByUserId(db, warehouse.id);
    expect((await request({ action: "split", input })).status).toBe(403);
    session.principal = await loadPrincipalByUserId(db, admin.id);
    expect((await request({ action: "split", input }, key, "https://untrusted.example")).status).toBe(403);
    const response = await request({ action: "split", input });
    expect(response.status).toBe(200);
    const split = await response.json();
    expect(await (await request({ action: "split", input })).json()).toEqual(split);
    expect(await db.query.auditLogs.findMany({ where: (row, { and, eq }) => and(eq(row.entityId, source.id), eq(row.action, "SKU_SPLIT")) })).toHaveLength(1);
    expect((await request({ action: "split", input: { ...input, reason: "Changed request" } })).status).toBe(409);
    const attribution = { action: "attribute", input: { sourceSkuId: source.id, targetSkuId: split.targetSkuIds[0],
            kind: "EVIDENCE", assetId: supports[0]!.id, claimSkuId: source.id, reason: "This statement describes the first unit" } };
    const attributionKey = createUuidV7();
    expect((await request(attribution, attributionKey)).status).toBe(200);
    expect((await request(attribution, attributionKey)).status).toBe(200);
    expect(await db.query.auditLogs.findMany({ where: (row, { and, eq }) => and(eq(row.entityId, split.targetSkuIds[0]), eq(row.action, "SKU_ASSET_ATTRIBUTED")) }))
        .toHaveLength(1);
});

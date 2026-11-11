import { readBoundedJson } from "../../../../lib/request-body.ts";
import { NextResponse } from "next/server";
import { getDb } from "@khidi/db";
import { assertRoleAllowed } from "@khidi/auth";
import { executeIdempotent } from "@khidi/domain";
import { upsertAccountingMapping } from "@khidi/products";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../../lib/scanning-response.ts";
export async function POST(request: Request) {
    try {
        const principal = await getCurrentPrincipal();
        if (!principal)
            throw new AppError("UNAUTHORIZED", "Authentication required.");
        assertRoleAllowed(principal, ["ADMIN"]);
        assertSecurityOrigin(request);
        const key = request.headers.get("Idempotency-Key") ?? "";
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))
            throw new AppError("VALIDATION_ERROR", "Invalid request key.");
        const body = await readBoundedJson(request) as Parameters<typeof upsertAccountingMapping>[2];
        if (!body.skuId || !body.legalEntityId || typeof body.accountingItemId !== "string" || typeof body.accountingName !== "string"
            || (body.confirmSharedAccountingItem !== undefined && typeof body.confirmSharedAccountingItem !== "boolean"))
            throw new AppError("VALIDATION_ERROR", "Accounting mapping fields are required.");
        const actor = { userId: principal.userId };
        const result = await executeIdempotent(getDb(), { scope: "catalog:accounting-mapping", idempotencyKey: key, payload: { body, ...actor } }, async (tx) => ({ status: 201, body: { ok: true, mapping: await upsertAccountingMapping(tx, actor, {
                    ...body, legacyCode: body.legacyCode || null, notes: body.notes || null, replaceExistingForEntity: true
                }) } }));
        return NextResponse.json(result.body, { status: result.status });
    }
    catch (error) {
        return scanningErrorResponse(error);
    }
}

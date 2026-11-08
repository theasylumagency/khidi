import { readBoundedJson } from "../../../../lib/request-body.ts";
import { NextResponse } from "next/server";
import { assertRoleAllowed } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { executeIdempotent } from "@khidi/domain";
import { attributeSkuAsset, splitSku } from "@khidi/products/corrections";
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
        const body = await readBoundedJson(request) as {
            action?: unknown;
            input?: unknown;
        };
        if (body.action !== "split" && body.action !== "attribute")
            throw new AppError("VALIDATION_ERROR", "Invalid correction action.");
        const actor = { userId: principal.userId };
        const result = await executeIdempotent(getDb(), { scope: "catalog:correction", idempotencyKey: key, payload: { body, ...actor } }, async (tx) => ({ status: 200, body: body.action === "split" ? await splitSku(tx, actor, body.input) : await attributeSkuAsset(tx, actor, body.input) }));
        return NextResponse.json(result.body, { status: result.status });
    }
    catch (error) {
        return scanningErrorResponse(error);
    }
}

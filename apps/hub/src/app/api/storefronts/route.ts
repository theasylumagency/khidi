import { NextResponse } from "next/server";
import { assertRoleAllowed } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { executeIdempotent } from "@khidi/domain";
import { createStorefront, createStorefrontSchema } from "@khidi/entities";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../lib/scanning-response.ts";

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN"]);
    assertSecurityOrigin(request);
    const input = createStorefrontSchema.strict().safeParse(await request.json());
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!input.success || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new AppError("VALIDATION_ERROR", "Invalid storefront request.");
    const actor = { userId: principal.userId };
    const result = await executeIdempotent(getDb(), { scope: "storefront:create:" + principal.userId, idempotencyKey: key, payload: input.data }, async (tx) => ({
      status: 201, body: { id: (await createStorefront(tx, actor, input.data)).id }
    }));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return scanningErrorResponse(error); }
}

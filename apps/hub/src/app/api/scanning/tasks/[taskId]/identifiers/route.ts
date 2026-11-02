import { NextResponse } from "next/server";
import { assertRoleAllowed } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { listTaskPhotoIdentifiers } from "@khidi/scanning";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../../../lib/session.ts";
import { scanningErrorResponse } from "../../../../../../lib/scanning-response.ts";
export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN", "WAREHOUSE", "OPERATOR", "STOCK_MANAGER", "ORDER_MANAGER"]);
    return NextResponse.json(await listTaskPhotoIdentifiers(getDb(), principal, (await context.params).taskId, new URL(request.url).searchParams.get("cursor") ?? undefined), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return scanningErrorResponse(error); }
}

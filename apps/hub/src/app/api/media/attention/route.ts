import { readBoundedJson } from "../../../../lib/request-body.ts";
import { NextResponse } from "next/server";
import { assertRoleAllowed } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { reportPhotoAttention } from "@khidi/media";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { mediaErrorResponse } from "../../../../lib/media-response.ts";
export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN", "WAREHOUSE", "OPERATOR", "STOCK_MANAGER", "ORDER_MANAGER"]);
    const result = await reportPhotoAttention(getDb(), principal, await readBoundedJson(request));
    return NextResponse.json({ ...result.body, replayed: result.replayed }, { status: result.status });
  } catch (error) { return mediaErrorResponse(error); }
}

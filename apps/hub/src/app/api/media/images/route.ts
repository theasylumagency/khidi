import { NextResponse } from "next/server";
import { assertRoleAllowed } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { listMediaImageViews, manageImage } from "@khidi/media";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { mediaErrorResponse } from "../../../../lib/media-response.ts";
export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal(); if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required."); assertRoleAllowed(principal, ["ADMIN"]);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    if (Object.keys(query).some((key) => !["skuId", "intakeId"].includes(key))) throw new AppError("VALIDATION_ERROR", "Invalid image target.");
    return NextResponse.json(await listMediaImageViews(getDb(), principal, query), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return mediaErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal(); if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required."); assertRoleAllowed(principal, ["ADMIN"]);
    const result = await manageImage(getDb(), principal, await request.json()); return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return mediaErrorResponse(error); }
}

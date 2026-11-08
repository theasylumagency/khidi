import { readBoundedJson } from "@khidi/shared/input-limits";
import { NextResponse } from "next/server";
import { assertRoleAllowed } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { listMediaJobs, retryMediaJob } from "@khidi/media";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { mediaErrorResponse } from "../../../../lib/media-response.ts";
export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal(); if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN"]);
    return NextResponse.json(await listMediaJobs(getDb(), principal, Number(new URL(request.url).searchParams.get("page") ?? 1)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return mediaErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal(); if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN"]);
    const result = await retryMediaJob(getDb(), principal, await readBoundedJson(request));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return mediaErrorResponse(error); }
}

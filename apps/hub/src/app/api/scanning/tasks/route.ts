import { readBoundedJson } from "../../../../lib/request-body.ts";
import { NextResponse } from "next/server";
import { getDb } from "@khidi/db";
import { assertRoleAllowed } from "@khidi/auth";
import { createScanTask } from "@khidi/scanning";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { scanningErrorResponse } from "../../../../lib/scanning-response.ts";

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN"]);
    const result = await createScanTask(getDb(), principal, await readBoundedJson(request));
    return NextResponse.json({ ...result.body, replayed: result.replayed }, { status: result.status });
  } catch (error) { return scanningErrorResponse(error); }
}

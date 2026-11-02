import { NextResponse } from "next/server";
import { assertRoleAllowed } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { getAssignedScanTask } from "@khidi/scanning";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../../lib/session.ts";
import { scanningErrorResponse } from "../../../../../lib/scanning-response.ts";

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN", "WAREHOUSE", "OPERATOR", "STOCK_MANAGER", "ORDER_MANAGER"]);
    const task = await getAssignedScanTask(getDb(), principal, (await params).taskId);
    return NextResponse.json(task, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return scanningErrorResponse(error); }
}

import { assertHubRequestHost } from "../../../lib/host-isolation.ts";
import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@khidi/db";
import { nowUtc } from "@khidi/shared";

export async function GET(request:Request) {
  try {assertHubRequestHost(request);} catch {return new NextResponse(null,{status:404});}
  await checkDatabaseHealth();

  return NextResponse.json({
    service: "khidi-hub",
    status: "ok",
    database: "connected",
    timestamp: nowUtc().toISOString()
  });
}

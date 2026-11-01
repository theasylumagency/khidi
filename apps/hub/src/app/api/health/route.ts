import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@khidi/db";
import { nowUtc } from "@khidi/shared";

export async function GET() {
  await checkDatabaseHealth();

  return NextResponse.json({
    service: "agrotrade-hub",
    status: "ok",
    database: "connected",
    timestamp: nowUtc().toISOString()
  });
}

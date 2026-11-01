import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@agrotrade/db";
import { nowUtc } from "@agrotrade/shared";

export async function GET() {
  await checkDatabaseHealth();

  return NextResponse.json({
    service: "agrotrade-hub",
    status: "ok",
    database: "connected",
    timestamp: nowUtc().toISOString()
  });
}

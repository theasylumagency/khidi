import { NextResponse } from "next/server";
import { canEditPrices, canViewPrices } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { executeIdempotent } from "@khidi/domain";
import { assertPriceAccess } from "@khidi/pricing";
import { commitCsvImport, exportPricesCsv, previewCsvImport, type CsvPriceInput } from "@khidi/pricing/csv";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../../lib/scanning-response.ts";

export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    if (!canViewPrices(principal)) throw new AppError("FORBIDDEN", "Price access denied.");
    const storefrontId = new URL(request.url).searchParams.get("storefrontId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(storefrontId)) throw new AppError("VALIDATION_ERROR", "Invalid storefront.");
    const csv = await exportPricesCsv(getDb(), { userId: principal.userId }, storefrontId);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="khidi-prices.csv"', "Cache-Control": "private, no-store" } });
  } catch (error) { return scanningErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    if (!canEditPrices(principal)) throw new AppError("FORBIDDEN", "Price editing denied.");
    assertSecurityOrigin(request);
    const db = getDb(), actor = { userId: principal.userId };
    await assertPriceAccess(db, actor, true);
    const body = await request.json() as { action?: string; input: CsvPriceInput; expectedPriceIds?: Record<string, string | null>; reason?: string; confirmLargeChanges?: boolean };
    if (body.action === "preview") return NextResponse.json(await previewCsvImport(db, actor, body.input));
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (body.action !== "commit" || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new AppError("VALIDATION_ERROR", "Invalid import request.");
    const result = await executeIdempotent(db, { scope: "m7:price-csv:" + principal.userId, idempotencyKey: key, payload: body }, async (tx) => ({
      status: 201, body: await commitCsvImport(tx, actor, { ...body.input, expectedPriceIds: body.expectedPriceIds!, reason: body.reason, confirmLargeChanges: body.confirmLargeChanges })
    }));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return scanningErrorResponse(error); }
}

import { readBoundedJson } from "../../../lib/request-body.ts";
import { NextResponse } from "next/server";
import { canEditPrices, canViewPrices } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { executeIdempotent } from "@khidi/domain";
import { assertPriceAccess, commitPriceChanges, copyPricePreview, getPriceHistory, listLatestPrices, previewPriceChanges, type PriceBatch } from "@khidi/pricing";
import { AppError } from "@khidi/shared";
import { formatStaffName } from "@khidi/i18n";
import { getCurrentPrincipal } from "../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../lib/scanning-response.ts";

export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    if (!canViewPrices(principal)) throw new AppError("FORBIDDEN", "Price access denied.");
    const db = getDb(), actor = { userId: principal.userId };
    await assertPriceAccess(db, actor);
    const query = new URL(request.url).searchParams;
    const skuId = query.get("skuId"), storefrontId = query.get("storefrontId");
    if ([skuId, storefrontId].some((value) => value !== null && !/^[0-9a-f-]{36}$/i.test(value))) throw new AppError("VALIDATION_ERROR", "Invalid price filter.");
    const rows = skuId ? (await getPriceHistory(db, actor, skuId, storefrontId ?? undefined)).map((row) => ({ ...row, authorName: formatStaffName(row.authorName) }))
      : await listLatestPrices(db, { storefrontId: storefrontId ?? undefined });
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "private, no-store" } });
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
    const body = await readBoundedJson(request) as { action?: string; batch?: PriceBatch; sourceStorefrontId?: string; targetStorefrontId?: string; skuIds?: string[]; expectedPriceIds?: Record<string, string | null> };
    if (body.action === "copy-preview") {
      return NextResponse.json({ preview: await copyPricePreview(db, actor, body.sourceStorefrontId!, body.targetStorefrontId!, body.skuIds!, body.expectedPriceIds!) });
    }
    if (!body.batch || !["MANUAL", "BULK"].includes(body.batch.source ?? "MANUAL")) throw new AppError("VALIDATION_ERROR", "Invalid price batch.");
    if (body.action === "preview") return NextResponse.json({ preview: await previewPriceChanges(db, actor, body.batch) });
    if (body.action !== "commit" || body.batch.changes.some((row) => row.expectedPriceId === undefined)) throw new AppError("VALIDATION_ERROR", "Preview required.");
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new AppError("VALIDATION_ERROR", "Invalid request key.");
    const result = await executeIdempotent(db, { scope: "m7:prices:" + principal.userId, idempotencyKey: key, payload: body }, async (tx) => ({
      status: 201, body: await commitPriceChanges(tx, actor, body.batch!)
    }));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return scanningErrorResponse(error); }
}

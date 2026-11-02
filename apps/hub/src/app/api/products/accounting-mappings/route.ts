import { NextResponse } from "next/server";
import { getDb } from "@khidi/db";
import { assertRoleAllowed } from "@khidi/auth";
import { upsertAccountingMapping } from "@khidi/products";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    assertRoleAllowed(principal, ["ADMIN"]);

    const body = (await request.json()) as {
      skuId?: string;
      legalEntityId?: string;
      accountingItemId?: string;
      accountingName?: string;
      legacyCode?: string;
      notes?: string;
    };

    if (!body.skuId || !body.legalEntityId || !body.accountingItemId || !body.accountingName) {
      return NextResponse.json(
        { error: "skuId, legalEntityId, accountingItemId, and accountingName are required" },
        { status: 400 }
      );
    }

    const db = getDb();
    const mapping = await upsertAccountingMapping(
      db,
      { userId: principal.userId },
      {
        skuId: body.skuId,
        legalEntityId: body.legalEntityId,
        accountingItemId: body.accountingItemId,
        accountingName: body.accountingName,
        legacyCode: body.legacyCode || null,
        notes: body.notes || null,
        replaceExistingForEntity: true
      }
    );

    return NextResponse.json({ ok: true, mapping }, { status: 201 });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to save accounting mapping" }, { status: 500 });
  }
}

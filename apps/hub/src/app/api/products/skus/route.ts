import { readBoundedJson } from "../../../../lib/request-body.ts";
import { NextResponse } from "next/server";
import { getDb } from "@khidi/db";
import { assertRoleAllowed } from "@khidi/auth";
import { createSkuDraft } from "@khidi/products";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    assertRoleAllowed(principal, ["ADMIN", "OPERATOR"]);

    const body = (await readBoundedJson(request)) as {
      productTypeId?: string;
      brand?: string;
      modelCode?: string;
      keyDifferentiatorKa?: string;
      keyDifferentiatorEn?: string;
      power?: string;
      workingWidth?: string;
      weight?: string;
      isComposedBundle?: boolean;
      isKit?: boolean;
    };

    const db = getDb();
    const created = await createSkuDraft(
      db,
      { userId: principal.userId },
      {
        productTypeId: body.productTypeId || null,
        brand: body.brand || null,
        modelCode: body.modelCode || null,
        keyDifferentiatorKa: body.keyDifferentiatorKa || null,
        keyDifferentiatorEn: body.keyDifferentiatorEn || null,
        isComposedBundle: Boolean(body.isComposedBundle),
        isKit: Boolean(body.isKit),
        universalUnits: {
          power: body.power || null,
          workingWidth: body.workingWidth || null,
          weight: body.weight || null
        }
      }
    );

    return NextResponse.json({ ok: true, sku: created }, { status: 201 });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create SKU draft" }, { status: 500 });
  }
}

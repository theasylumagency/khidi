import { NextResponse } from "next/server";
import { getDb } from "@khidi/db";
import { assertRoleAllowed } from "@khidi/auth";
import {
  type IdentityConfidenceLevel,
  setSkuIdentityConfidence
} from "@khidi/products";
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
      level?: IdentityConfidenceLevel;
      reason?: string;
    };

    if (!body.skuId || !body.level || !body.reason?.trim()) {
      return NextResponse.json(
        {
          error:
            "skuId, level, and a non-empty reason are required to manually set identity confidence (G1).",
          code: "VALIDATION_ERROR"
        },
        { status: 400 }
      );
    }

    const db = getDb();
    const updated = await setSkuIdentityConfidence(
      db,
      { userId: principal.userId },
      body.skuId,
      body.level,
      body.reason
    );

    return NextResponse.json({ ok: true, sku: updated });
  } catch (err) {
    if (err instanceof AppError) {
      const status = err.code === "FORBIDDEN" ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return NextResponse.json(
      { error: "Failed to manually set SKU identity confidence" },
      { status: 500 }
    );
  }
}

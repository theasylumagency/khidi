import { readBoundedJson } from "@khidi/shared/input-limits";
import { NextResponse } from "next/server";
import { getDb } from "@khidi/db";
import { assertRoleAllowed } from "@khidi/auth";
import { setStorefrontListing } from "@khidi/products";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    assertRoleAllowed(principal, ["ADMIN"]);

    const body = (await readBoundedJson(request)) as {
      storefrontId?: string;
      skuId?: string;
      enabled?: boolean;
      reason?: string;
    };

    if (!body.storefrontId || !body.skuId || typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "storefrontId, skuId, and boolean enabled are required" },
        { status: 400 }
      );
    }

    const db = getDb();
    const listing = await setStorefrontListing(
      db,
      { userId: principal.userId },
      {
        storefrontId: body.storefrontId,
        skuId: body.skuId,
        enabled: body.enabled,
        reason: body.reason
      }
    );

    return NextResponse.json({ ok: true, listing });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update storefront listing" }, { status: 500 });
  }
}

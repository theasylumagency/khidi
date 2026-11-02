import { NextResponse } from "next/server";
import { getDb } from "@khidi/db";
import { assertRoleAllowed } from "@khidi/auth";
import {
  type IdentityConfidenceLevel,
  type SkuLifecycleState,
  transitionSkuLifecycle,
  transitionSkuToReady,
  updateSkuCanonicalSlug
} from "@khidi/products";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    assertRoleAllowed(principal, ["ADMIN", "OPERATOR"]);

    const body = (await request.json()) as {
      skuId?: string;
      action?: "TRANSITION_READY" | "TRANSITION_LIFECYCLE" | "UPDATE_SLUG";
      targetState?: Exclude<SkuLifecycleState, "READY">;
      identityConfidence?: IdentityConfidenceLevel;
      humanConfirmedMediumConfidence?: boolean;
      customCanonicalSlug?: string;
      reason?: string;
    };

    if (!body.skuId) {
      return NextResponse.json({ error: "skuId is required" }, { status: 400 });
    }

    const db = getDb();

    if (body.action === "TRANSITION_LIFECYCLE" && body.targetState) {
      const updated = await transitionSkuLifecycle(
        db,
        { userId: principal.userId },
        body.skuId,
        body.targetState,
        {
          identityConfidence: body.identityConfidence,
          reason: body.reason
        }
      );
      return NextResponse.json({ ok: true, sku: updated });
    }

    // READY transition and canonical slug update require ADMIN
    assertRoleAllowed(principal, ["ADMIN"]);

    if (body.action === "UPDATE_SLUG" && body.customCanonicalSlug) {
      const updated = await updateSkuCanonicalSlug(
        db,
        { userId: principal.userId },
        body.skuId,
        body.customCanonicalSlug,
        body.reason
      );
      return NextResponse.json({ ok: true, sku: updated });
    }

    const updated = await transitionSkuToReady(
      db,
      { userId: principal.userId },
      body.skuId,
      {
        customCanonicalSlug: body.customCanonicalSlug,
        humanConfirmedMediumConfidence: body.humanConfirmedMediumConfidence
      }
    );

    return NextResponse.json({ ok: true, sku: updated });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update SKU readiness or slug" }, { status: 500 });
  }
}

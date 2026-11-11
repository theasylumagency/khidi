import { readBoundedJson } from "../../../../lib/request-body.ts";
import { NextResponse } from "next/server";
import { getDb } from "@khidi/db";
import { assertRoleAllowed } from "@khidi/auth";
import { executeIdempotent } from "@khidi/domain";
import {
  type SkuLifecycleState,
  transitionSkuLifecycle,
  transitionSkuToReady,
  updateSkuCanonicalSlug
} from "@khidi/products";
import { AppError, createUuidV7 } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    assertRoleAllowed(principal, ["ADMIN", "OPERATOR"]);

    const body = (await readBoundedJson(request)) as {
      skuId?: string;
      action?: "TRANSITION_READY" | "TRANSITION_LIFECYCLE" | "UPDATE_SLUG";
      targetState?: Exclude<SkuLifecycleState, "READY">;
      identityConfidence?: unknown;
      humanConfirmedMediumConfidence?: boolean;
      customCanonicalSlug?: string;
      allowHouseSlugSuffix?: boolean;
      reason?: string;
    };

    if (!body.skuId) {
      return NextResponse.json({ error: "skuId is required" }, { status: 400 });
    }

    if (body.identityConfidence !== undefined) {
      return NextResponse.json(
        {
          error:
            "Identity confidence is computed from evidence.",
          code: "VALIDATION_ERROR"
        },
        { status: 400 }
      );
    }

    const { skuId, action } = body;
    if (action !== "TRANSITION_LIFECYCLE") assertRoleAllowed(principal, ["ADMIN"]);
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? createUuidV7();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      throw new AppError("VALIDATION_ERROR", "Invalid request key.");
    }
    const actor = { userId: principal.userId };
    const result = await executeIdempotent(getDb(), {
      scope: "products:ready", idempotencyKey, payload: { ...body, ...actor }
    }, async (tx) => {
      if (action === "TRANSITION_LIFECYCLE" && body.targetState) {
        const sku = await transitionSkuLifecycle(tx, actor, skuId, body.targetState, { reason: body.reason });
        return { status: 200, body: { ok: true, sku } };
      }
      if (action === "UPDATE_SLUG" && body.customCanonicalSlug) {
        const sku = await updateSkuCanonicalSlug(tx, actor, skuId, body.customCanonicalSlug, body.reason);
        return { status: 200, body: { ok: true, sku } };
      }
      if (action && action !== "TRANSITION_READY") throw new AppError("VALIDATION_ERROR", "Invalid SKU action.");
      const sku = await transitionSkuToReady(tx, actor, skuId, {
        customCanonicalSlug: body.customCanonicalSlug, allowHouseSlugSuffix: body.allowHouseSlugSuffix === true,
        humanConfirmedMediumConfidence: body.humanConfirmedMediumConfidence
      });
      return { status: 200, body: { ok: true, sku } };
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update SKU readiness or slug" }, { status: 500 });
  }
}

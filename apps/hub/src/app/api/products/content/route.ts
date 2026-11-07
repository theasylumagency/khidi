import { NextResponse } from "next/server";
import { assertRoleAllowed } from "@khidi/auth";
import { queueAiJob } from "@khidi/ai";
import { getDb } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { approveCanonicalVersion, saveCanonicalVersion, saveTechnicalSynonyms } from "@khidi/products";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../../lib/scanning-response.ts";

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN"]);
    assertSecurityOrigin(request);
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
      throw new AppError("VALIDATION_ERROR", "Invalid request key.");
    }
    const body = await request.json() as { action?: string; skuId?: string; locale?: string; versionId?: string; draft?: unknown; synonyms?: unknown };
    const actor = { userId: principal.userId };
    const result = await executeIdempotent<unknown, { id: string }>(getDb(),
      { scope: "m6:canonical-content", idempotencyKey: key, payload: { ...body, ...actor } }, async (tx) => {
        if (body.action === "save-synonyms") return { status: 200, body: await saveTechnicalSynonyms(tx, actor, body.synonyms) };
        if (body.action === "approve") {
          const version = await approveCanonicalVersion(tx, actor, { skuId: body.skuId, versionId: body.versionId });
          return { status: 200, body: { id: version.id } };
        }
        if (body.action === "ai" && /^[0-9a-f-]{36}$/i.test(body.skuId ?? "")) {
          const id = await withDomainTransaction(tx, actor, (ctx) => queueAiJob(ctx, { skuId: body.skuId!, jobName: "generate-canonical-content" }));
          return { status: 202, body: { id } };
        }
        if (body.action !== "generate" && (body.action !== "save" || !body.draft)) {
          throw new AppError("VALIDATION_ERROR", "Unknown content action.");
        }
        const { version } = await saveCanonicalVersion(tx, actor, {
          skuId: body.skuId, locale: body.locale, draft: body.action === "save" ? body.draft : undefined
        });
        return { status: 201, body: { id: version.id } };
      });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    if (error instanceof AppError && Array.isArray(error.details?.issues)) {
      return NextResponse.json({ issues: error.details.issues }, { status: 400 });
    }
    return scanningErrorResponse(error);
  }
}

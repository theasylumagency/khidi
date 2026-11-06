import { NextResponse } from "next/server";
import { assertRoleAllowed } from "@khidi/auth";
import { AI_JOB_NAMES, queueAiJob, retryAiJob, type AiJobName } from "@khidi/ai";
import { getDb } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../../lib/scanning-response.ts";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN"]);
    assertSecurityOrigin(request);
    const key = request.headers.get("Idempotency-Key") ?? "";
    const body = await request.json() as { id?: string; skuId?: string; jobName?: AiJobName; imageId?: string; imageVersion?: number; evidenceId?: string };
    if (!uuid.test(key) || (body.id ? !uuid.test(body.id) : !uuid.test(body.skuId ?? "") || !body.jobName || !AI_JOB_NAMES.includes(body.jobName))
      || (body.imageId !== undefined && !uuid.test(body.imageId)) || (body.evidenceId !== undefined && !uuid.test(body.evidenceId))) {
      throw new AppError("VALIDATION_ERROR", "Invalid AI job request.");
    }
    const result = await executeIdempotent(getDb(), { scope: "m5:ai-jobs", idempotencyKey: key, payload: { ...body, userId: principal.userId } }, (tx) =>
      withDomainTransaction(tx, { userId: principal.userId }, async (ctx) => {
        if (body.id) await retryAiJob(ctx, body.id);
        else await queueAiJob(ctx, { skuId: body.skuId!, jobName: body.jobName!, imageId: body.imageId,
          imageVersion: body.imageVersion, evidenceId: body.evidenceId });
        return { status: 202, body: { ok: true } };
      }));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return scanningErrorResponse(error); }
}

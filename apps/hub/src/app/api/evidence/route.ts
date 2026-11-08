import { readBoundedJson, parseBoundedObjectJson } from "@khidi/shared/input-limits";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getDb } from "@khidi/db";
import { assertRoleAllowed } from "@khidi/auth";
import { executeIdempotent } from "@khidi/domain";
import {
  classifySkuProductType, decideSkuEvidenceField, registerObservableAttribute, reviewSkuEvidence, setSkuIdentityKind, submitSkuEvidence,
  type IdentityKind
} from "@khidi/evidence";
import { getMediaStorage, MAX_PHOTO_BYTES, storeEvidenceAttachment } from "@khidi/media";
import { getAssignedScanTask } from "@khidi/scanning";
import { listProductTypes, upsertProductType } from "@khidi/products";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../lib/session.ts";
import { readPhotoFormData } from "../../../lib/photo-upload-body.ts";
import { mediaErrorResponse } from "../../../lib/media-response.ts";
import { assertSameSecurityOrigin } from "../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../lib/scanning-response.ts";

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN", "WAREHOUSE"]);
    assertSameSecurityOrigin(request);
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!uuidV7.test(key)) throw new AppError("VALIDATION_ERROR", "Evidence submission key is required.");
    if (Number(request.headers.get("Content-Length") ?? 0) > MAX_PHOTO_BYTES + 65_536) {
      throw new AppError("VALIDATION_ERROR", "Upload too large.", { mediaReason: "FILE_TOO_LARGE" });
    }
    const multipart = request.headers.get("Content-Type")?.startsWith("multipart/form-data");
    const form = multipart ? await readPhotoFormData(request) : null;
    const metadata = form?.get("evidence");
    if (form && (typeof metadata !== "string" || metadata.length > 16_384)) throw new AppError("VALIDATION_ERROR", "Invalid evidence metadata.");
    const body = (typeof metadata === "string" ? parseBoundedObjectJson(metadata) : await readBoundedJson(request)) as Record<string, unknown>;
    const { action, ...input } = body ?? {};
    const file = form?.get("photo");
    if (file instanceof File && file.name && !file.size) throw new AppError("VALIDATION_ERROR", "Evidence attachment is empty.");
    if (file instanceof File && file.size > MAX_PHOTO_BYTES) {
      throw new AppError("VALIDATION_ERROR", "Upload too large.", { mediaReason: "FILE_TOO_LARGE" });
    }
    const bytes = file instanceof File && file.size ? new Uint8Array(await file.arrayBuffer()) : null;
    const db = getDb(), actor = { userId: principal.userId };
    if (action !== "submit" || !input.taskId) assertRoleAllowed(principal, ["ADMIN"]);
    if (action === "submit" && input.taskId) {
      const task = await getAssignedScanTask(db, principal, String(input.taskId));
      if (task.taskType !== "EVIDENCE_REQUEST" || task.targetSkuId !== input.skuId) throw new AppError("FORBIDDEN", "Assigned evidence task required.");
    }
    const result = await executeIdempotent<unknown, { ok: true; id?: string }>(db, { scope: "m5:evidence", idempotencyKey: key,
      payload: { action, ...input, userId: principal.userId, sha256: bytes ? createHash("sha256").update(bytes).digest("hex") : null } }, async (tx) => {
      if (action === "submit") {
        const skuId = String(input.skuId ?? "");
        if (!uuid.test(skuId)) throw new AppError("VALIDATION_ERROR", "SKU is required.");
        const media = bytes && file instanceof File ? await storeEvidenceAttachment(tx, getMediaStorage(), {
          id: key, skuId, userId: principal.userId, deviceId: principal.deviceId ?? undefined,
          declaredMimeType: file.type, evidenceType: String(input.type),
          privateDocument: ["SUPPLIER_DOCUMENT", "CUSTOMS_DECLARATION", "SUPPLIER_CORRESPONDENCE", "SUPPLIER_CATALOG"].includes(String(input.type))
        }, bytes) : null;
        const item = await submitSkuEvidence(tx, actor, { ...input, ...(media?.imageId ? { imageId: media.imageId } : {}) }, media?.attachment);
        return { status: 201, body: { ok: true, id: item.id } };
      }
      if (action === "review") await reviewSkuEvidence(tx, actor, input);
      else if (action === "field") await decideSkuEvidenceField(tx, actor, input);
      else if (action === "identity-kind") await setSkuIdentityKind(tx, actor, String(input.skuId), input.kind as IdentityKind, String(input.reason ?? ""));
      else if (action === "classify") await classifySkuProductType(tx, actor, String(input.skuId), String(input.productTypeId), String(input.reason ?? ""));
      else if (action === "register-observable") await registerObservableAttribute(tx, actor, input);
      else if (action === "distinguishing") {
        const productType = (await listProductTypes(tx)).find((type) => type.id === input.productTypeId);
        if (!productType || !Array.isArray(input.fields) || !input.fields.every((field) => typeof field === "string")
          || typeof input.reason !== "string" || !input.reason.trim()) {
          throw new AppError("VALIDATION_ERROR", "Product Type, distinguishing attributes and reason required.");
        }
        await upsertProductType(tx, actor, { ...productType, distinguishingAttributes: input.fields as string[], reason: input.reason });
      }
      else throw new AppError("VALIDATION_ERROR", "Unknown evidence action.");
      return { status: 200, body: { ok: true } };
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return error instanceof AppError && error.details?.mediaReason ? mediaErrorResponse(error) : scanningErrorResponse(error);
  }
}

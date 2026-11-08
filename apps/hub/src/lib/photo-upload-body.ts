import { AppError } from "@khidi/shared";
import { MAX_PHOTO_BYTES } from "@khidi/media/contracts";
import { readBoundedForm,parseBoundedObjectJson } from "@khidi/shared/input-limits";
import { assertSameSecurityOrigin } from "./security-origin.ts";
/** Bound the actual stream too: Content-Length is optional and untrusted. */
export async function readPhotoFormData(request: Request) {
  assertSameSecurityOrigin(request);
  const limit = MAX_PHOTO_BYTES + 65536;
  if (Number(request.headers.get("content-length")) > limit) throw new AppError("VALIDATION_ERROR", "Upload exceeds size limit.", { mediaReason: "FILE_TOO_LARGE" });
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;") || !request.body) throw new AppError("VALIDATION_ERROR", "Multipart upload required.");
  try {
    return await readBoundedForm(request,limit);
  }catch(error){
    if(error instanceof AppError&&error.code==="PAYLOAD_TOO_LARGE")throw new AppError("VALIDATION_ERROR","Upload exceeds size limit.",{mediaReason:"FILE_TOO_LARGE"});
    throw new AppError("VALIDATION_ERROR","Invalid multipart upload.");
  }
}

export async function parsePhotoUpload(request: Request) {
  const form = await readPhotoFormData(request);
  const metadata = form.get("metadata"), file = form.get("file"), key = request.headers.get("Idempotency-Key");
  if (!(file instanceof File) || typeof metadata !== "string" || metadata.length > 16384 || !key) throw new AppError("VALIDATION_ERROR", "Photo, metadata and Idempotency-Key are required.");
  if (file.size > MAX_PHOTO_BYTES) throw new AppError("VALIDATION_ERROR", "Photo exceeds size limit.", { mediaReason: "FILE_TOO_LARGE" });
  let input: Record<string, unknown>;
  try { input = parseBoundedObjectJson(metadata); }
  catch { throw new AppError("VALIDATION_ERROR", "Invalid photo metadata."); }
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== key) throw new AppError("VALIDATION_ERROR", "Photo key differs from the Idempotency-Key header.");
  return { input: { ...input, idempotencyKey: key }, bytes: new Uint8Array(await file.arrayBuffer()) };
}

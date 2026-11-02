import { AppError } from "@khidi/shared";
import { MAX_PHOTO_BYTES } from "@khidi/media/contracts";
/** Bound the actual stream too: Content-Length is optional and untrusted. */
export async function parsePhotoUpload(request: Request) {
  const limit = MAX_PHOTO_BYTES + 65536;
  if (Number(request.headers.get("content-length")) > limit) throw new AppError("VALIDATION_ERROR", "Upload exceeds size limit.", { mediaReason: "FILE_TOO_LARGE" });
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;") || !request.body) throw new AppError("VALIDATION_ERROR", "Multipart upload required.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new AppError("VALIDATION_ERROR", "Upload exceeds size limit.", { mediaReason: "FILE_TOO_LARGE" }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(Uint8Array.from(Buffer.concat(chunks)).buffer, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData(); }
  catch { throw new AppError("VALIDATION_ERROR", "Invalid multipart upload."); }
  const metadata = form.get("metadata"), file = form.get("file"), key = request.headers.get("Idempotency-Key");
  if (!(file instanceof File) || typeof metadata !== "string" || metadata.length > 16384 || !key) throw new AppError("VALIDATION_ERROR", "Photo, metadata and Idempotency-Key are required.");
  if (file.size > MAX_PHOTO_BYTES) throw new AppError("VALIDATION_ERROR", "Photo exceeds size limit.", { mediaReason: "FILE_TOO_LARGE" });
  let input: Record<string, unknown>;
  try { input = JSON.parse(metadata); if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(); }
  catch { throw new AppError("VALIDATION_ERROR", "Invalid photo metadata."); }
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== key) throw new AppError("VALIDATION_ERROR", "Photo key differs from the Idempotency-Key header.");
  return { input: { ...input, idempotencyKey: key }, bytes: new Uint8Array(await file.arrayBuffer()) };
}

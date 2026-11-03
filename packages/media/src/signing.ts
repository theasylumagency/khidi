import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@khidi/shared";
export const DEV_MEDIA_SIGNING_SECRET = "khidi_media_signing_development_secret_only";
export function mediaSigningSecret(env: NodeJS.ProcessEnv = process.env) {
  const key = env.MEDIA_SIGNING_SECRET?.trim() || (env.NODE_ENV !== "production" ? DEV_MEDIA_SIGNING_SECRET : "");
  if (key.length < 32 || env.NODE_ENV === "production" && key === DEV_MEDIA_SIGNING_SECRET) throw new Error("CRITICAL: a non-development MEDIA_SIGNING_SECRET of at least 32 characters is required.");
  return key;
}
export interface PrivateMediaRequest { imageId: string; variant: string; version: number; expires: number; signature: string }
const variantValid = (variant: string) => /^(raw|master|(?:400|800|1600)\.(?:webp|avif))$/.test(variant);
function signature(userId: string, request: Omit<PrivateMediaRequest, "signature">, key: string) { return createHmac("sha256", key).update(JSON.stringify(["khidi-media-v1", userId, request.imageId, request.variant, request.version, request.expires])).digest("hex"); }
export function signPrivateMedia(userId: string, imageId: string, variant: string, version: number, now = Date.now(), key = mediaSigningSecret()) {
  if (!variantValid(variant) || !Number.isSafeInteger(version) || version < 0) throw new Error("Invalid private media variant.");
  const request = { imageId, variant, version, expires: Math.floor(now / 1000) + 300 };
  return `/api/media/view?${new URLSearchParams({ ...request, version: String(version), expires: String(request.expires), signature: signature(userId, request, key) })}`;
}
export function verifyPrivateMedia(userId: string, raw: Record<string, string>, now = Date.now(), key = mediaSigningSecret()): Omit<PrivateMediaRequest, "signature"> {
  const request = { imageId: raw.imageId ?? "", variant: raw.variant ?? "", version: Number(raw.version), expires: Number(raw.expires) }, seconds = Math.floor(now / 1000);
  if (Object.keys(raw).some((name) => !["imageId", "variant", "version", "expires", "signature"].includes(name)) || !/^[a-f0-9-]{36}$/i.test(request.imageId)
    || !variantValid(request.variant) || !Number.isSafeInteger(request.version) || request.version < 0 || !Number.isSafeInteger(request.expires) || request.expires <= seconds || request.expires > seconds + 300 || !/^[a-f0-9]{64}$/.test(raw.signature ?? "")) throw new AppError("FORBIDDEN", "Private media URL expired or invalid.");
  const expected = Buffer.from(signature(userId, request, key), "hex"), actual = Buffer.from(raw.signature!, "hex");
  if (!timingSafeEqual(expected, actual)) throw new AppError("FORBIDDEN", "Private media signature mismatch."); return request;
}

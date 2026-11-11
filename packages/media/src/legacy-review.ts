import sharp from "sharp";
import { AppError } from "@khidi/shared";
import { sniffPhotoMime } from "./formats.ts";
import { privateImageKey, type MediaStorage } from "./storage.ts";

/** Editorial preview for an imported original. It has no canonical image or SKU record. */
export async function storeLegacyReviewPhoto(storage: MediaStorage, id: string, bytes: Uint8Array) {
  const mime = sniffPhotoMime(bytes);
  if (!mime) throw new AppError("VALIDATION_ERROR", "Unsupported legacy photo format.");
  const preview = await sharp(bytes, { limitInputPixels: 64_000_000, failOn: "error" })
    .rotate().toColourspace("srgb")
    .resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 }).toBuffer();
  const raw = await storage.putPrivate(privateImageKey(id, "legacy-original"), bytes, mime);
  const derivative = await storage.putPrivate(privateImageKey(id, "v1/legacy-review.webp", "master"), preview, "image/webp");
  return { raw, preview: derivative };
}

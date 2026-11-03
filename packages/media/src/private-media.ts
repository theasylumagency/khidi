import { and, eq } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, imageMasterVersions, productImages } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { assertMediaPrincipal } from "./principal.ts";
import { verifyPrivateMedia } from "./signing.ts";
import type { MediaStorage } from "./storage.ts";
export async function readSignedPrivateMedia(db: DbExecutor, storage: MediaStorage, principal: AuthenticatedPrincipal, raw: Record<string, string>, now = Date.now()) {
  await assertMediaPrincipal(db, principal, true);
  const request = verifyPrivateMedia(principal.userId, raw, now);
  const [image] = await db.select().from(productImages).where(eq(productImages.id, request.imageId)).limit(1);
  if (!image) throw new AppError("NOT_FOUND", "Image not found.");
  if (request.variant === "raw") {
    if (request.version !== 0) throw new AppError("VALIDATION_ERROR", "Raw has no processing version.");
    return { bytes: await storage.readPrivate(image.rawStorageKey, image.rawSha256, image.rawVersionId ?? undefined), contentType: image.mimeType };
  }
  const [master] = await db.select().from(imageMasterVersions).where(and(eq(imageMasterVersions.imageId, image.id), eq(imageMasterVersions.version, request.version))).limit(1);
  if (!master) throw new AppError("NOT_FOUND", "Master version not found.");
  if (request.variant === "master") return { bytes: await storage.readPrivate(master.storageKey, master.sha256, master.storageVersionId ?? undefined), contentType: "image/jpeg" };
  const derivative = master.derivativesJson[request.variant]; if (!derivative) throw new AppError("NOT_FOUND", "Derivative not found.");
  return { bytes: await storage.readPrivate(derivative.key, derivative.sha256, derivative.versionId), contentType: derivative.contentType };
}

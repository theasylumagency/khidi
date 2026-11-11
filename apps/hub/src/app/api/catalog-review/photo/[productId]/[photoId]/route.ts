import { assertRoleAllowed } from "@khidi/auth";
import { getReviewPhoto, reviewId, reviewRoles } from "@khidi/catalog-review";
import { getDb } from "@khidi/db";
import { getMediaStorage } from "@khidi/media";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../../../lib/session.ts";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

export async function GET(_request: Request, { params }: { params: Promise<{ productId: string; photoId: string }> }) {
  try {
    const principal = await getCurrentPrincipal({ allowCatalogReviewer: true });
    if (!principal) return new Response(null, { status: 401, headers });
    assertRoleAllowed(principal, [...reviewRoles]);
    const { productId, photoId } = await params;
    if (!reviewId.safeParse(productId).success || !reviewId.safeParse(photoId).success) {
      return new Response(null, { status: 404, headers });
    }
    const photo = await getReviewPhoto(getDb(), principal, productId, photoId);
    const bytes = await getMediaStorage().readPrivate(photo.key, photo.sha256, photo.version ?? undefined);
    return new Response(new Uint8Array(bytes).buffer, { headers: { ...headers, "Content-Type": "image/webp" } });
  } catch (error) {
    const status = error instanceof AppError ? (error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 500) : 500;
    return new Response(null, { status, headers });
  }
}

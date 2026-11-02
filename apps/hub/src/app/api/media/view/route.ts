import { assertRoleAllowed } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { getMediaStorage, readSignedPrivateMedia } from "@khidi/media";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { mediaErrorResponse } from "../../../../lib/media-response.ts";
export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal(); if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required."); assertRoleAllowed(principal, ["ADMIN"]);
    const image = await readSignedPrivateMedia(getDb(), getMediaStorage(), principal, Object.fromEntries(new URL(request.url).searchParams));
    return new Response(new Uint8Array(image.bytes).buffer, { headers: { "Content-Type": image.contentType, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return mediaErrorResponse(error); }
}

import { NextResponse } from "next/server";
import { assertRoleAllowed } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { receivePhoto } from "@khidi/media";
import { getMediaStorage } from "@khidi/media/storage-config";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { mediaErrorResponse } from "../../../../lib/media-response.ts";
import { parsePhotoUpload } from "../../../../lib/photo-upload-body.ts";

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN", "WAREHOUSE", "OPERATOR", "STOCK_MANAGER", "ORDER_MANAGER"]);
    const { input, bytes } = await parsePhotoUpload(request);
    const result = await receivePhoto(getDb(), getMediaStorage(), principal, input, bytes);
    return NextResponse.json({ ...result.body, replayed: result.replayed }, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return mediaErrorResponse(error); }
}

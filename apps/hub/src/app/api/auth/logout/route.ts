import { readBoundedText, parseBoundedObjectJson } from "@khidi/shared/input-limits";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@khidi/db";
import { revokeSessionToken } from "@khidi/auth";
import { AppError } from "@khidi/shared";
import { KHIDI_SESSION_COOKIE } from "../../../../lib/session.ts";
import { assertSameSecurityOrigin } from "../../../../lib/security-origin.ts";

export async function POST(request: NextRequest) {
  try { assertSameSecurityOrigin(request); }
  catch { return NextResponse.json({ ok: false }, { status: 403 }); }
  let text:string;
  try{text=await readBoundedText(request,4096);}catch(error){return NextResponse.json({ok:false},{status:error instanceof AppError&&error.code==="PAYLOAD_TOO_LARGE"?413:400});}
  let expectedId: string | undefined;
  if (text) {
    try { const id=parseBoundedObjectJson(text).sessionId;if(typeof id!=="string")throw new Error();expectedId=id; }
    catch { return NextResponse.json({ ok: false }, { status: 400 }); }
    if (typeof expectedId !== "string") return NextResponse.json({ ok: false }, { status: 400 });
  }
  const rawToken = request.cookies.get(KHIDI_SESSION_COOKIE)?.value;
  if (rawToken) {
    try {
      const db = getDb();
      const revoked = await revokeSessionToken(db, rawToken, expectedId);
      if (expectedId && !revoked) return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ ok: false }, { status: 503 });
    }
  }

  const response = NextResponse.json({
    ok: true,
    redirectTo: "/login"
  });

  response.cookies.set(KHIDI_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });

  return response;
}

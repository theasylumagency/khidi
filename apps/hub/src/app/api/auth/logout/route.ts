import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@khidi/db";
import { revokeSessionToken } from "@khidi/auth";
import { KHIDI_SESSION_COOKIE } from "../../../../lib/session.ts";

export async function POST(request: NextRequest) {
  const rawToken = request.cookies.get(KHIDI_SESSION_COOKIE)?.value;
  if (rawToken) {
    try {
      const db = getDb();
      await revokeSessionToken(db, rawToken);
    } catch {
      // Ignore DB error during logout cleanup
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

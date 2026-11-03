import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@khidi/db";
import { loginOfficeUser } from "@khidi/auth";
import { AppError } from "@khidi/shared";
import { KHIDI_SESSION_COOKIE } from "../../../../lib/session.ts";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      totpCode?: string;
    };

    if (!body.email || !body.password) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "ელ-ფოსტა და პაროლი სავალდებულოა." },
        { status: 400 }
      );
    }

    const db = getDb();
    const { sessionToken, principal } = await loginOfficeUser(db, {
      email: body.email,
      password: body.password,
      totpCode: body.totpCode?.trim() || undefined,
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined
    });

    const response = NextResponse.json({
      ok: true,
      principal: {
        userId: principal.userId,
        fullName: principal.fullName,
        role: principal.role
      },
      redirectTo: "/"
    });

    response.cookies.set(KHIDI_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 12 * 60 * 60
    });

    return response;
  } catch (err) {
    if (err instanceof AppError) {
      if (err.code === "PRECONDITION_FAILED" && err.details?.totpEnrollment) {
        return NextResponse.json({ ok: true, enrollment: err.details.totpEnrollment }, { headers: { "Cache-Control": "no-store" } });
      }
      const status = err.code === "UNAUTHORIZED" ? 401 : err.code === "FORBIDDEN" ? 403 : 400;
      return NextResponse.json({ error: err.code, message: err.message }, { status });
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "ავტორიზაციისას დაფიქსირდა შეცდომა." },
      { status: 500 }
    );
  }
}

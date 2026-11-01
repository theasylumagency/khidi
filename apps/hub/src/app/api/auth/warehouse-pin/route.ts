import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@khidi/db";
import { loginWithWarehousePin } from "@khidi/auth";
import { AppError } from "@khidi/shared";
import { KHIDI_DEVICE_COOKIE, KHIDI_SESSION_COOKIE } from "../../../../lib/session.ts";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      userId?: string;
      pin?: string;
    };

    const rawDeviceToken = request.cookies.get(KHIDI_DEVICE_COOKIE)?.value;
    if (!rawDeviceToken) {
      return NextResponse.json(
        {
          error: "UNAUTHORIZED",
          message: "ეს მოწყობილობა არ არის რეგისტრირებული საწყობის ტერმინალად (საჭიროა ADMIN-ის მიერ რეგისტრაცია)."
        },
        { status: 401 }
      );
    }

    if (!body.userId || !body.pin) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "აირჩიეთ თანამშრომელი და შეიყვანეთ PIN კოდი." },
        { status: 400 }
      );
    }

    const db = getDb();
    const { sessionToken, principal } = await loginWithWarehousePin(db, {
      rawDeviceToken,
      userId: body.userId,
      pin: body.pin.trim(),
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
      maxAge: 4 * 60 * 60
    });

    return response;
  } catch (err) {
    if (err instanceof AppError) {
      const status = err.code === "UNAUTHORIZED" ? 401 : err.code === "FORBIDDEN" ? 403 : 400;
      return NextResponse.json({ error: err.code, message: err.message }, { status });
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "PIN ავტორიზაციისას დაფიქსირდა შეცდომა." },
      { status: 500 }
    );
  }
}

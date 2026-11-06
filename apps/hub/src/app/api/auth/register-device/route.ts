import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@khidi/db";
import { registerWarehouseDevice } from "@khidi/auth";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal, KHIDI_DEVICE_COOKIE } from "../../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../../lib/security-origin.ts";
import { t } from "@khidi/i18n";

export async function POST(request: NextRequest) {
  try {
    assertSecurityOrigin(request);
    const principal = await getCurrentPrincipal();
    if (!principal) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "საჭიროა ADMIN ავტორიზაცია." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as { deviceName?: string };
    if (!body.deviceName || body.deviceName.trim().length < 2) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "მიუთითეთ მოწყობილობის დასახელება." },
        { status: 400 }
      );
    }

    const db = getDb();
    const registered = await registerWarehouseDevice(db, principal, {
      deviceName: body.deviceName.trim()
    });

    const response = NextResponse.json({
      ok: true,
      deviceId: registered.deviceId,
      deviceName: registered.deviceName
    });

    // Bind this browser/phone to the registered device token via HttpOnly cookie
    response.cookies.set(KHIDI_DEVICE_COOKIE, registered.rawDeviceToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 365 * 24 * 60 * 60
    });

    return response;
  } catch (err) {
    if (err instanceof AppError) {
      if (err.code === "RECENT_AUTH_REQUIRED") return NextResponse.json({ error: err.code, message: t("passkey.reauth_required") }, { status: 428, headers: { "Cache-Control": "no-store" } });
      const status = err.code === "UNAUTHORIZED" ? 401 : err.code === "FORBIDDEN" ? 403 : 400;
      return NextResponse.json({ error: err.code, message: err.message }, { status });
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "მოწყობილობის რეგისტრაციისას დაფიქსირდა შეცდომა." },
      { status: 500 }
    );
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@khidi/db";
import { loginOfficeUser, listOwnPasskeys } from "@khidi/auth";
import { AppError } from "@khidi/shared";
import { renderInternalQrSvg } from "@khidi/products/labels";
import { t } from "@khidi/i18n";
import { KHIDI_SESSION_COOKIE, isSharedWarehouseBrowser } from "../../../../lib/session.ts";

const json: typeof NextResponse.json = (body, init) => NextResponse.json(body, {
  ...init, headers: { ...init?.headers, "Cache-Control": "no-store" }
});

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      totpCode?: string;
      restartEnrollment?: boolean;
    };

    if (!body || typeof body.email !== "string" || !body.email.trim() || body.email.length > 254
      || typeof body.password !== "string" || !body.password || body.password.length > 1024
      || (body.totpCode !== undefined && typeof body.totpCode !== "string")
      || (body.restartEnrollment !== undefined && typeof body.restartEnrollment !== "boolean")) {
      return json(
        { error: "VALIDATION_ERROR", message: t("auth.credentials_required") },
        { status: 400 }
      );
    }

    const db = getDb();
    const { sessionToken, principal } = await loginOfficeUser(db, {
      email: body.email,
      password: body.password,
      totpCode: body.totpCode?.trim() || undefined,
      restartEnrollment: body.restartEnrollment,
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined
    });

    const response = json({
      ok: true,
      offerPasskey: Boolean(principal.lastStrongAuthAt) && !await isSharedWarehouseBrowser() && !(await listOwnPasskeys(db, principal)).length,
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
        const enrollment = err.details.totpEnrollment as { base32Secret: string; otpauthUri: string; accountLabel: string };
        return json({ ok: true, enrollment: { ...enrollment, qrSvg: renderInternalQrSvg(enrollment.otpauthUri, 240) } });
      }
      const status = err.code === "UNAUTHORIZED" ? 401 : err.code === "FORBIDDEN" ? 403 : 400;
      return json({ error: err.code, message: t("auth.login_failed") }, { status });
    }
    return json(
      { error: "INTERNAL_ERROR", message: t("auth.login_unavailable") },
      { status: 500 }
    );
  }
}

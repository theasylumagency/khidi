import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@khidi/db";
import { executeIdempotent } from "@khidi/domain";
import { AppError } from "@khidi/shared";
import { t } from "@khidi/i18n";
import { beginPasskeyCeremony, finishPasskeyCeremony, ownSecurityState, manageOwnPasskey,
  reauthenticateWithPasswordTotp, startOwnTotpEnrollment, changeOwnPassword, securityRequestFingerprint,
  type RegistrationResponseJSON, type AuthenticationResponseJSON } from "@khidi/auth";
import { renderInternalQrSvg } from "@khidi/products/labels";
import { getCurrentPrincipal, isSharedWarehouseBrowser, KHIDI_SESSION_COOKIE } from "../../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../../lib/security-origin.ts";
import { QUICK_SIGN_IN_COOKIE, QUICK_SIGN_IN_DEFERRED_COOKIE, quickSignInCookieOptions, readQuickSignInPreference, signQuickSignInPreference } from "../../../../lib/quick-sign-in-cookie.ts";

const BINDING_COOKIE = "khidi_webauthn";
const cookieOptions = { httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/api/auth/passkeys", maxAge: 300 };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function failure(error: unknown, publicSignIn = false) {
  if (publicSignIn) return json({ error: "UNAUTHORIZED", message: t("passkey.sign_in_failed") }, 401);
  const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
  const status = code === "RECENT_AUTH_REQUIRED" ? 428 : code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : code === "INTERNAL_ERROR" ? 500 : 400;
  return json({ error: code, message: t(code === "RECENT_AUTH_REQUIRED" ? "passkey.reauth_required" : "passkey.operation_failed") }, status);
}

function ownRememberedPreference(preference: ReturnType<typeof readQuickSignInPreference>, keys: { id: string }[]) {
  return preference && preference.mode !== "deferred" && keys.some((key) => key.id === preference.id) ? preference : null;
}

export async function GET() {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal || principal.authMethod === "WAREHOUSE_PIN" || principal.role === "WAREHOUSE") throw new AppError("UNAUTHORIZED", "Office login required.");
    const state = await ownSecurityState(getDb(), principal, await isSharedWarehouseBrowser());
    const remembered = readQuickSignInPreference((await cookies()).get(QUICK_SIGN_IN_COOKIE)?.value);
    const preference = ownRememberedPreference(remembered, state.keys);
    return json({ ok: true, ...state, rememberName: preference ? preference.mode === "named" : null });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  let publicSignIn = false, finishing = false;
  try {
    assertSecurityOrigin(request);
    const text = await request.text();
    if (Buffer.byteLength(text) > 65536) throw new AppError("VALIDATION_ERROR", "Request too large.");
    const body = JSON.parse(text) as Record<string, unknown>;
    const action = body?.action;
    if (typeof action !== "string") throw new AppError("VALIDATION_ERROR", "Action required.");
    publicSignIn = action.startsWith("sign-in-");
    finishing = action.endsWith("-verify");
    const principal = await getCurrentPrincipal(), sharedDevice = await isSharedWarehouseBrowser() || principal?.authMethod === "WAREHOUSE_PIN", db = getDb();
    if (!publicSignIn && (!principal || principal.authMethod === "WAREHOUSE_PIN" || principal.role === "WAREHOUSE")) throw new AppError("UNAUTHORIZED", "Office login required.");
    const passkeyAction = ["register-options", "register-verify", "sign-in-options", "sign-in-verify", "reauth-options", "reauth-verify", "rename", "revoke", "defer-offer", "remember-name"].includes(action);
    if (passkeyAction && sharedDevice) throw new AppError("FORBIDDEN", "Passkeys unavailable on a warehouse browser.");

    if (action === "defer-offer") {
      if (!principal!.lastStrongAuthAt) throw new AppError("FORBIDDEN", "Strong sign-in required.");
      const response = json({ ok: true });
      response.cookies.set(QUICK_SIGN_IN_DEFERRED_COOKIE, signQuickSignInPreference("deferred", principal!.userId), quickSignInCookieOptions);
      return response;
    }

    if (action === "remember-name") {
      if (typeof body.enabled !== "boolean") throw new AppError("VALIDATION_ERROR", "Name preference required.");
      const state = await ownSecurityState(db, principal!, sharedDevice);
      const remembered = readQuickSignInPreference(request.cookies.get(QUICK_SIGN_IN_COOKIE)?.value);
      const preference = ownRememberedPreference(remembered, state.keys);
      if (!preference) throw new AppError("FORBIDDEN", "An active passkey remembered in this browser is required.");
      const response = json({ ok: true });
      response.cookies.set(QUICK_SIGN_IN_COOKIE, signQuickSignInPreference(body.enabled ? "named" : "key", preference.id), quickSignInCookieOptions);
      return response;
    }

    if (["register-options", "sign-in-options", "reauth-options"].includes(action)) {
      const ceremony = action === "register-options" ? "REGISTER" : action === "reauth-options" ? "REAUTH" : "SIGN_IN";
      const result = await beginPasskeyCeremony(db, ceremony, ceremony === "SIGN_IN" ? null : principal, sharedDevice);
      const response = json({ ok: true, challengeId: result.challengeId, options: result.options });
      response.cookies.set(BINDING_COOKIE, result.bindingToken, cookieOptions);
      return response;
    }
    if (["register-verify", "sign-in-verify", "reauth-verify"].includes(action)) {
      const preference = readQuickSignInPreference(request.cookies.get(QUICK_SIGN_IN_COOKIE)?.value);
      const keepNameOnRegistration = action === "register-verify" && preference?.mode === "named"
        && !!ownRememberedPreference(preference, (await ownSecurityState(db, principal!, sharedDevice)).keys);
      const result = await finishPasskeyCeremony(db, { ceremony: action === "register-verify" ? "REGISTER" : action === "reauth-verify" ? "REAUTH" : "SIGN_IN",
        challengeId: String(body.challengeId ?? ""), bindingToken: request.cookies.get(BINDING_COOKIE)?.value ?? "",
        response: body.response as RegistrationResponseJSON | AuthenticationResponseJSON, desktopIpad: body.desktopIpad === true,
        principal: publicSignIn ? null : principal, sharedDevice,
        ipAddress: request.headers.get("x-forwarded-for") ?? undefined, userAgent: request.headers.get("user-agent") ?? undefined });
      const response = json({ ok: true });
      response.cookies.set(BINDING_COOKIE, "", { ...cookieOptions, maxAge: 0 });
      if ("sessionToken" in result && result.sessionToken) response.cookies.set(KHIDI_SESSION_COOKIE, result.sessionToken, {
        httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 60 * 60 });
      if (result.passkeyId && action !== "reauth-verify") {
        const named = action === "register-verify" ? keepNameOnRegistration || body.rememberName === true
          : preference?.mode === "named" && preference.id === result.passkeyId;
        response.cookies.set(QUICK_SIGN_IN_COOKIE, signQuickSignInPreference(named ? "named" : "key", result.passkeyId), quickSignInCookieOptions);
      }
      return response;
    }
    if (action === "password-reauth") {
      if (typeof body.password !== "string" || typeof body.totpCode !== "string") throw new AppError("VALIDATION_ERROR", "Password and code required.");
      await reauthenticateWithPasswordTotp(db, principal!, { password: body.password, totpCode: body.totpCode });
      return json({ ok: true });
    }
    if (action === "totp-start" || action === "totp-replace") {
      if (typeof body.password !== "string") throw new AppError("VALIDATION_ERROR", "Password required.");
      const enrollment = await startOwnTotpEnrollment(db, principal!, { password: body.password, replace: action === "totp-replace" });
      const response = json({ ok: true, enrollment: { ...enrollment, qrSvg: renderInternalQrSvg(enrollment.otpauthUri, 240) } });
      response.cookies.set(KHIDI_SESSION_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
      return response;
    }
    if (!["rename", "revoke", "change-password"].includes(action)) throw new AppError("VALIDATION_ERROR", "Unknown action.");
    const key = request.headers.get("idempotency-key");
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new AppError("VALIDATION_ERROR", "Idempotency key required.");
    const result = await executeIdempotent(db, { scope: `account-security:${principal!.userId}:${principal!.sessionId}`, idempotencyKey: key,
      payload: securityRequestFingerprint(body) }, async (tx) => {
      if (action === "change-password") {
        if (typeof body.password !== "string") throw new AppError("VALIDATION_ERROR", "Password required.");
        await changeOwnPassword(tx, principal!, body.password);
        return { status: 200, body: { ok: true, currentSessionRevoked: false } };
      }
      if (action !== "rename" && action !== "revoke") throw new AppError("VALIDATION_ERROR", "Unknown action.");
      const changed = await manageOwnPasskey(tx, principal!, { action, id: String(body.id ?? ""), displayName: typeof body.displayName === "string" ? body.displayName : undefined });
      return { status: 200, body: { ok: true, ...changed } };
    });
    const response = json(result.body, result.status);
    if (result.body.currentSessionRevoked) response.cookies.set(KHIDI_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    if (action === "revoke" && readQuickSignInPreference(request.cookies.get(QUICK_SIGN_IN_COOKIE)?.value)?.id === body.id) {
      response.cookies.set(QUICK_SIGN_IN_COOKIE, "", { ...quickSignInCookieOptions, maxAge: 0 });
    }
    return response;
  } catch (error) {
    const response = failure(error, publicSignIn);
    if (finishing) response.cookies.set(BINDING_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return response;
  }
}

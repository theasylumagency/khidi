import { readBoundedJson } from "../../../../lib/request-body.ts";
import { NextResponse, type NextRequest } from "next/server";
import { renewSessionActivity } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal, KHIDI_SESSION_COOKIE } from "../../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../../lib/security-origin.ts";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const denied = () => json({ ok: false, error: "SESSION_ENDED" }, 401);

export async function POST(request: NextRequest) {
  try { assertSecurityOrigin(request); }
  catch { return json({ ok: false }, 403); }
  const token = request.cookies.get(KHIDI_SESSION_COOKIE)?.value;
  if (!token) return denied();
  let body:Record<string,unknown>;
  try{body=await readBoundedJson(request,4096);}catch(error){return json({ok:false},error instanceof AppError&&error.code==="PAYLOAD_TOO_LARGE"?413:400);}
  if (typeof body?.sessionId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.sessionId)) return json({ ok: false }, 400);
  try {
    if (body.action === "status") {
      const timing = (await getCurrentPrincipal({ throwOnUnavailable: true }))?.sessionTiming;
      return timing && timing.sessionId === body.sessionId ? json(timing) : denied();
    }
    if (body.action !== "activity" || typeof body.lastActivityAtMs!=="number" || !Number.isSafeInteger(body.lastActivityAtMs) || body.lastActivityAtMs <= 0) return json({ ok: false }, 400);
    return json(await renewSessionActivity(getDb(), token, body.sessionId, body.lastActivityAtMs));
  } catch (error) {
    return error instanceof AppError && error.code === "UNAUTHORIZED" ? denied() : json({ ok: false }, 503);
  }
}

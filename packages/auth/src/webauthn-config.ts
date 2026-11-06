/** Explicit origin/RP pairing; never infer trust from request/forwarded headers. */
export function webauthnConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const rpID = env.WEBAUTHN_RP_ID?.trim() || (production ? "" : "localhost");
  const origin = env.WEBAUTHN_ORIGIN?.trim() || (production ? "" : "http://localhost:3100");
  try {
    const url = new URL(origin);
    if (!rpID || url.hostname !== rpID || url.origin !== origin || url.username || url.password
      || !["http:", "https:"].includes(url.protocol)
      || (url.protocol !== "https:" && url.hostname !== "localhost")) throw new Error();
    if (production && (rpID !== "app.khidi.app" || origin !== "https://app.khidi.app")) throw new Error();
  } catch { throw new Error("CRITICAL: Configure the exact WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN. Production requires app.khidi.app and https://app.khidi.app; HTTP is allowed only on localhost outside production."); }
  const recentSeconds = Number(env.AUTH_RECENT_WINDOW_SECONDS ?? 600);
  if (!Number.isSafeInteger(recentSeconds) || recentSeconds < 1 || recentSeconds > 3600) {
    throw new Error("CRITICAL: AUTH_RECENT_WINDOW_SECONDS must be 1..3600 (default 600).");
  }
  return { rpID, origin, rpName: "Khidi", recentWindowMs: recentSeconds * 1000 };
}

import type { SessionTiming } from "@khidi/auth";
import type { SessionRequest } from "./session-monitor.ts";

export const SESSION_CHANNEL = "khidi-session-v1";
export const SESSION_ACTIVITY_EVENT = "khidi:meaningful-activity";
export const SESSION_ENROLLMENT_EVENT = "khidi:auth-enrollment";
export function recordSessionActivity() { window.dispatchEvent(new Event(SESSION_ACTIVITY_EVENT)); }

function signalEnd(sessionId: string) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  channel.postMessage({ sessionId, kind: "ended" }); channel.close();
}

export async function leaveSession(sessionId: string, expired: boolean, setupToken?:string) {
  signalEnd(sessionId);
  try {
    const registration=await navigator.serviceWorker?.getRegistration?.();
    await(await registration?.pushManager?.getSubscription())?.unsubscribe();
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_AUTH_CACHES" });
    if ("caches" in window) await Promise.all((await caches.keys()).filter((key) => key.startsWith("khidi-")).map((key) => caches.delete(key)));
  } catch { /* Navigation still discards authenticated in-memory content. */ }
  window.location.replace(!expired && setupToken && /^[A-Za-z0-9_-]{43}$/.test(setupToken) ? "/login?setup=1#setup="+setupToken : expired ? "/login?session=expired" : "/login");
}

export async function logoutSession(sessionId: string, setupToken?:string) {
  const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
    signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
  if (!response.ok) throw new Error("Logout unavailable.");
  // Explicit setup handoff must stop this tab's idle monitor before its logout broadcast;
  // otherwise its expiry redirect can race away the new account's in-memory setup token.
  if(setupToken)window.dispatchEvent(new Event(SESSION_ENROLLMENT_EVENT));
  await leaveSession(sessionId, false,setupToken);
}

export function sessionRequest(sessionId: string): SessionRequest {
  return async (action, lastActivityAtMs) => {
    const response = await fetch("/api/auth/session-activity", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, sessionId, lastActivityAtMs }) });
    const body = await response.json();
    if (response.status === 401 && body?.error === "SESSION_ENDED") return null;
    if (!response.ok || body?.sessionId !== sessionId || ![body.lastActivityAtMs, body.deadlineMs, body.absoluteDeadlineMs, body.serverNowMs, body.activityIntervalMs].every(Number.isSafeInteger)) throw new Error("Session check unavailable.");
    return body as SessionTiming;
  };
}

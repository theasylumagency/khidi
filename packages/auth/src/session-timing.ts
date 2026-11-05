import { AppError } from "@khidi/shared";

export const SESSION_ACTIVITY_INTERVAL_MS = 30_000;
export const sessionIdleLimitMs = (method: string) => (method === "WAREHOUSE_PIN" ? 10 : 20) * 60_000;

type SessionTimes = { id: string; authMethod: string; lastActivityAt: Date; expiresAt: Date };

export function sessionTiming(session: SessionTimes, now = Date.now()) {
  const lastActivityAtMs = session.lastActivityAt.getTime();
  const deadlineMs = Math.min(session.expiresAt.getTime(), lastActivityAtMs + sessionIdleLimitMs(session.authMethod));
  if (deadlineMs <= now) throw new AppError("UNAUTHORIZED", "Session expired or invalid.");
  return { sessionId: session.id, lastActivityAtMs, deadlineMs, serverNowMs: now, activityIntervalMs: SESSION_ACTIVITY_INTERVAL_MS,
    absoluteDeadlineMs: session.expiresAt.getTime() };
}

export type SessionTiming = ReturnType<typeof sessionTiming>;

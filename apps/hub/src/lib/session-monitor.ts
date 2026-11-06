import type { SessionTiming } from "@khidi/auth";

export type SessionRequest = (action: "status" | "activity", revision: number) => Promise<SessionTiming | null>;
export type SessionWarning = { seconds: number; absolute: boolean; locked: boolean } | null;
const WARNING_MS = 60_000;

/** The browser schedules UI only. Every extension and terminal decision is confirmed by the server. */
export function monitorSession(initial: SessionTiming, io: {
  now: () => number; request: SessionRequest; visible: () => boolean;
  warning: (warning: SessionWarning) => void; unavailable: (unavailable: boolean) => void;
  renewed: () => void; ended: () => void;
}) {
  let timing = initial, sampleAt = io.now(), lastAttemptAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined, pending: Promise<boolean> | undefined;
  let stopped = false, checkedDeadline = false, recheck = false;
  const remaining = () => sampleAt + timing.deadlineMs - timing.serverNowMs - io.now();

  function schedule() {
    clearTimeout(timer);
    if (stopped || !io.visible()) return;
    const left = remaining();
    io.warning(left > WARNING_MS ? null : { seconds: Math.max(0, Math.ceil(left / 1000)),
      absolute: timing.deadlineMs === timing.absoluteDeadlineMs, locked: left <= 0 });
    if (left <= 0) {
      if (!checkedDeadline && !pending) { checkedDeadline = true; void request("status"); }
    } else timer = setTimeout(schedule, left > WARNING_MS ? left - WARNING_MS : Math.min(left, 1000));
  }

  function request(action: "status" | "activity"): Promise<boolean> {
    if (stopped) return Promise.resolve(false);
    if (pending) return pending;
    const sentAt = io.now();
    if (action === "activity") lastAttemptAt = sentAt;
    pending = (async () => {
      try {
        const result = await io.request(action, timing.lastActivityAtMs);
        if (stopped) return false;
        if (!result || result.sessionId !== timing.sessionId) { stop(); io.ended(); return false; }
        const advanced = result.lastActivityAtMs > timing.lastActivityAtMs;
        // A status request can reach the server just before expiry and return just after it.
        // Schedule the next check from receipt of the authoritative remaining time.
        checkedDeadline = false;
        timing = result; sampleAt = io.now();
        io.unavailable(false);
        if (action === "activity" && advanced) io.renewed();
        return true;
      } catch {
        if (!stopped) io.unavailable(true);
        return false;
      } finally {
        pending = undefined;
        if (recheck && !stopped) { recheck = false; void request("status"); }
        else schedule();
      }
    })();
    return pending;
  }

  function refresh() {
    if (stopped || !io.visible()) return;
    schedule();
    if (pending) { recheck = true; return; }
    void request("status");
  }

  function stop() { stopped = true; clearTimeout(timer); }
  schedule();
  return {
    activity() {
      // No trailing heartbeat. A timer, tab focus, reconnect or poll never proves user presence.
      const dueAt = sampleAt + timing.lastActivityAtMs + timing.activityIntervalMs - timing.serverNowMs;
      if (!stopped && !pending && io.visible() && remaining() > WARNING_MS && io.now() >= Math.max(dueAt, lastAttemptAt + timing.activityIntervalMs)) void request("activity");
    },
    refresh,
    async continue() {
      if (pending) await pending;
      if (stopped) return false;
      // A prior attempt may have missed another tab's extension; check with the current cookie.
      if (remaining() <= 0 && !await request("status")) return false;
      if (timing.deadlineMs === timing.absoluteDeadlineMs && remaining() <= WARNING_MS) return false;
      return request("activity");
    },
    stop
  };
}

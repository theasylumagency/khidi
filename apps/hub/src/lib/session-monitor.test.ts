import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { monitorSession } from "./session-monitor.ts";
import type { SessionTiming } from "@khidi/auth";

const MINUTE = 60_000;
const START = 1_000_000;
const makeTiming = (overrides: Partial<SessionTiming> = {}): SessionTiming => ({
  sessionId: "tab-shared", deadlineMs: START + 20 * MINUTE, serverNowMs: START,
  lastActivityAtMs: START, absoluteDeadlineMs: START + 720 * MINUTE, activityIntervalMs: 30_000, ...overrides
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
afterEach(() => vi.useRealTimers());

function fixture(initial = makeTiming()) {
  const io = { now: Date.now, request: vi.fn(async (_action, _revision): Promise<SessionTiming | null> => initial),
    visible: vi.fn(() => true), warning: vi.fn(), unavailable: vi.fn(), renewed: vi.fn(), ended: vi.fn() };
  return { io, watch: monitorSession(initial, io) };
}

it("warns a minute before expiry, sends no heartbeat on timers, and requires server denial to log out", async () => {
  const { io } = fixture(); io.request.mockResolvedValue(null);
  await vi.advanceTimersByTimeAsync(19 * MINUTE);
  expect(io.warning).toHaveBeenLastCalledWith({ seconds: 60, absolute: false, locked: false });
  expect(io.request).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(io.request).toHaveBeenCalledExactlyOnceWith("status", START);
  expect(io.ended).toHaveBeenCalledOnce();
});

it("renews only on a throttled interaction and explicit continue, not focus or another tab's signal", async () => {
  const { io, watch } = fixture();
  watch.refresh(); await vi.advanceTimersByTimeAsync(0);
  expect(io.request).toHaveBeenCalledExactlyOnceWith("status", START);
  io.request.mockClear();
  watch.activity(); expect(io.request).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
  const advanced = makeTiming({ serverNowMs: Date.now(), lastActivityAtMs: Date.now(), deadlineMs: Date.now() + 20 * MINUTE });
  io.request.mockResolvedValue(advanced);
  for (let i = 0; i < 10; i++) watch.activity();
  await vi.advanceTimersByTimeAsync(0);
  expect(io.request).toHaveBeenCalledExactlyOnceWith("activity", START);
  expect(io.renewed).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(19 * MINUTE);
  io.request.mockClear(); watch.activity();
  expect(io.request).not.toHaveBeenCalled();
  io.request.mockResolvedValue(makeTiming({ serverNowMs: Date.now(), lastActivityAtMs: Date.now(), deadlineMs: Date.now() + 20 * MINUTE }));
  expect(await watch.continue()).toBe(true);
  expect(io.request).toHaveBeenCalledExactlyOnceWith("activity", advanced.lastActivityAtMs);
  expect(io.warning).toHaveBeenLastCalledWith(null);
});

it("takes a shared deadline from the server, not a tab message, and ignores an old session identity", async () => {
  const { io, watch } = fixture();
  await vi.advanceTimersByTimeAsync(19 * MINUTE);
  io.request.mockResolvedValue(makeTiming({ serverNowMs: Date.now(), lastActivityAtMs: Date.now(), deadlineMs: Date.now() + 20 * MINUTE }));
  watch.refresh(); await vi.advanceTimersByTimeAsync(0);
  expect(io.warning).toHaveBeenLastCalledWith(null);
  expect(io.request).toHaveBeenLastCalledWith("status", START);
  io.request.mockResolvedValue(makeTiming({ sessionId: "new-user-session" }));
  watch.refresh(); await vi.advanceTimersByTimeAsync(0);
  expect(io.ended).toHaveBeenCalledOnce();
});

it("keeps the page locked if offline at expiry and verifies on return without renewing", async () => {
  const { io, watch } = fixture(); io.visible.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(21 * MINUTE);
  expect(io.request).not.toHaveBeenCalled();
  io.visible.mockReturnValue(true); io.request.mockRejectedValue(new Error("Offline"));
  watch.refresh(); await vi.advanceTimersByTimeAsync(0);
  expect(io.warning).toHaveBeenLastCalledWith({ seconds: 0, absolute: false, locked: true });
  expect(io.unavailable).toHaveBeenLastCalledWith(true);
  expect(io.ended).not.toHaveBeenCalled();
  io.request.mockResolvedValue(null); watch.refresh(); await vi.advanceTimersByTimeAsync(0);
  expect(io.ended).toHaveBeenCalledOnce();
  expect(io.request.mock.calls.every(([action]) => action === "status")).toBe(true);
});

it("does not offer an extension beyond the absolute limit", async () => {
  const { io, watch } = fixture(makeTiming({ deadlineMs: START + MINUTE, absoluteDeadlineMs: START + MINUTE }));
  expect(io.warning).toHaveBeenLastCalledWith({ seconds: 60, absolute: true, locked: false });
  expect(await watch.continue()).toBe(false);
  expect(io.request).not.toHaveBeenCalled();
});

it("checks again if a near-deadline response arrives after the browser's earlier deadline", async () => {
  const deadlineMs = START + MINUTE;
  const { io } = fixture(makeTiming({ deadlineMs }));
  io.request.mockImplementationOnce(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return makeTiming({ deadlineMs, serverNowMs: deadlineMs - 1 });
  }).mockResolvedValueOnce(null);
  await vi.advanceTimersByTimeAsync(MINUTE + 26);
  expect(io.request.mock.calls).toEqual([["status", START], ["status", START]]);
  expect(io.ended).toHaveBeenCalledOnce();
});

import { describe, expect, it, vi } from "vitest";
import { CameraShellLifecycle, containBounds, scanFeedback, type CameraShellEnvironment } from "./camera-shell.ts";
import { cameraFlow, INITIAL_CAMERA_FLOW } from "./camera-flow.ts";

function fixture() {
  const doc = Object.assign(new EventTarget(), { hidden: false }), win = new EventTarget();
  const states: unknown[] = [{ page: "task", nextRouter: true }];
  const history = { state: states[0], pushState: vi.fn((state: unknown) => { states.push(state); history.state = state; }),
    back: vi.fn(() => { states.pop(); history.state = states.at(-1); win.dispatchEvent(new Event("popstate")); }) };
  const release = vi.fn(async () => {}), stop = vi.fn(), closed = vi.fn(), restore = vi.fn();
  const env: CameraShellEnvironment = { document: doc, window: win, history, lockScroll: vi.fn(() => restore), requestWakeLock: vi.fn(async () => ({ release })) };
  const shell = new CameraShellLifecycle(env, "camera-test", stop, closed);
  return { shell, env, doc, win, history, release, stop, closed, restore };
}
describe("camera shell lifecycle", () => {
  it("opens once, preserves the router state, closes on Back without leaving the page", async () => {
    const f = fixture(); f.shell.open(); f.shell.open();
    expect(f.history.pushState).toHaveBeenCalledTimes(1);
    expect(f.history.state).toMatchObject({ page: "task", nextRouter: true, khidiCamera: "camera-test" });
    await vi.waitFor(() => expect(f.env.requestWakeLock).toHaveBeenCalledTimes(1));
    f.history.back();
    expect(f.history.state).toEqual({ page: "task", nextRouter: true });
    expect(f.history.back).toHaveBeenCalledTimes(1);
    expect(f.stop).toHaveBeenCalledTimes(1); expect(f.closed).toHaveBeenCalledTimes(1); expect(f.restore).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledTimes(1);
  });
  it("releases Wake Lock and stops tracks on background/page exit, then releases again on close", async () => {
    const f = fixture(); f.shell.open(); await vi.waitFor(() => expect(f.env.requestWakeLock).toHaveBeenCalledTimes(1));
    f.doc.hidden = true; f.doc.dispatchEvent(new Event("visibilitychange"));
    expect(f.stop).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledTimes(1);
    f.doc.hidden = false; f.doc.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(f.env.requestWakeLock).toHaveBeenCalledTimes(2));
    f.win.dispatchEvent(new Event("pagehide"));
    expect(f.stop).toHaveBeenCalledTimes(2); expect(f.release).toHaveBeenCalledTimes(2); expect(f.history.back).not.toHaveBeenCalled();
  });
  it("releases a late Wake Lock after close and tolerates an unsupported/denied API", async () => {
    const f = fixture(); let resolve!: (value: { release(): Promise<void> }) => void;
    f.env.requestWakeLock = vi.fn(() => new Promise<{ release(): Promise<void> }>((done) => { resolve = done; }));
    f.shell.open(); f.shell.close(); resolve({ release: f.release });
    await vi.waitFor(() => expect(f.release).toHaveBeenCalledTimes(1));
    expect(f.closed).toHaveBeenCalledTimes(1);
    f.env.requestWakeLock = undefined; f.shell.open(); f.shell.close();
    f.env.requestWakeLock = async () => { throw new Error("Denied"); }; f.shell.open(); f.shell.close();
    expect(f.closed).toHaveBeenCalledTimes(3);
  });
  it("does not navigate backward if another navigation already owns the history entry", () => {
    const f = fixture(); f.shell.open(); f.history.state = { page: "different" }; f.shell.close();
    expect(f.history.back).not.toHaveBeenCalled(); expect(f.stop).toHaveBeenCalledOnce();
  });
});
it("keeps unfinished photos and scan flow on close/open; manual and completed work return immediately to scanner", () => {
  const scan = cameraFlow(INITIAL_CAMERA_FLOW, { type: "open" });
  const sheet = cameraFlow(scan, { type: "sheet", sheet: "manual" });
  expect(cameraFlow(sheet, { type: "stored" })).toEqual(scan);
  const photo = cameraFlow(scan, { type: "photos", photo: { target: { intakeIdempotencyKey: "queued-original" }, onlyMissing: false } });
  const reopened = cameraFlow(cameraFlow(photo, { type: "close" }), { type: "open" });
  expect(reopened.photo).toBe(photo.photo); expect(reopened.open).toBe(true);
  expect(cameraFlow(reopened, { type: "photos-complete" })).toEqual(scan);
  expect(cameraFlow(sheet, { type: "sheet", sheet: null })).toEqual(scan);
});
it("maps the photo guide to uncropped landscape/portrait pixels and never to letterboxing", () => {
  expect(containBounds(390, 600, 1920, 1080)).toEqual({ left: 0, top: 190.3125, width: 390, height: 219.375 });
  expect(containBounds(900, 600, 1200, 1800)).toEqual({ left: 250, top: 0, width: 400, height: 600 });
  expect(containBounds(0, 600, 1920, 1080)).toBeNull();
});
it("has distinct optional vibration patterns; failure/unsupported vibration never blocks acceptance", () => {
  const vibrate = vi.fn(() => true);
  for (const result of ["accepted", "duplicate", "review"] as const) scanFeedback(result, { vibrate });
  expect(vibrate.mock.calls).toEqual([[[45]], [[25, 60, 25]], [[100, 60, 100]]]);
  expect(() => scanFeedback("accepted", {})).not.toThrow();
  expect(() => scanFeedback("review", { vibrate: () => { throw new Error("Denied"); } })).not.toThrow();
});

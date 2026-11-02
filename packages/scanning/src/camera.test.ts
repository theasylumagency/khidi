import { afterEach, describe, expect, it, vi } from "vitest";
import { BarcodeFormat, QRCodeWriter } from "@zxing/library";
import { loadZxingDecoder, ScannerCamera, SCAN_FORMATS, type CameraEnvironment, type CameraState, type DetectorConstructor } from "./camera.ts";

function fixture(detector?: DetectorConstructor, torch = false) {
  const track = Object.assign(new EventTarget(), { stop: vi.fn(), getCapabilities: () => ({ torch }), applyConstraints: vi.fn(async () => {}) });
  const otherTrack = { stop: vi.fn(), removeEventListener: vi.fn() };
  const stream = { getTracks: () => [track, otherTrack], getVideoTracks: () => [track] } as unknown as MediaStream;
  const video = { muted: false, playsInline: false, srcObject: null, readyState: 2, videoWidth: 640, play: vi.fn(async () => {}), pause: vi.fn() } as unknown as HTMLVideoElement;
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const window = new EventTarget();
  const fallback = { decode: vi.fn(async (): Promise<string | null> => null), reset: vi.fn() };
  const env: CameraEnvironment = { detector, getUserMedia: vi.fn(async () => stream), document: doc, window, loadFallback: vi.fn(async () => fallback) };
  const scan = vi.fn(async () => true), states: CameraState[] = [];
  const camera = new ScannerCamera(env, scan, (state) => states.push(state));
  return { camera, track, otherTrack, stream, video, doc, window, fallback, env, scan, states };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("S6 browser camera lifecycle and decoders", () => {
  it("prefers rear video inline, selects supported native formats, and only accepts one stationary label", async () => {
    vi.useFakeTimers();
    let value: string | null = "KH-000123";
    const detect = vi.fn(async () => value ? [{ rawValue: value }] : []);
    const options: unknown[] = [];
    class Native {
      static async getSupportedFormats() { return [...SCAN_FORMATS, "aztec"]; }
      constructor(option: unknown) { options.push(option); }
      detect = detect;
    }
    const f = fixture(Native, true);
    await f.camera.start(f.video); await vi.advanceTimersByTimeAsync(600);
    expect(f.env.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false, video: expect.objectContaining({ facingMode: { ideal: "environment" } }) }));
    expect(f.video.muted && f.video.playsInline).toBe(true);
    expect(options).toEqual([{ formats: [...SCAN_FORMATS] }]);
    expect(f.env.loadFallback).not.toHaveBeenCalled(); expect(f.scan).toHaveBeenCalledTimes(1);
    value = "KH-000124"; await vi.advanceTimersByTimeAsync(120);
    expect(f.scan).toHaveBeenLastCalledWith("KH-000124");
    value = null; await vi.advanceTimersByTimeAsync(900);
    value = "KH-000124"; await vi.advanceTimersByTimeAsync(120);
    expect(f.scan).toHaveBeenCalledTimes(3);
    await f.camera.toggleTorch();
    expect(f.track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(f.states.at(-1)).toMatchObject({ torchAvailable: true, torchOn: true });
    f.camera.stop();
    expect(f.track.stop).toHaveBeenCalledTimes(1); expect(f.otherTrack.stop).toHaveBeenCalledTimes(1);
    expect(f.video.srcObject).toBe(null);
    await vi.advanceTimersByTimeAsync(1000); expect(f.scan).toHaveBeenCalledTimes(3);
    let finishDetection!: (rows: Array<{ rawValue: string }>) => void;
    detect.mockImplementationOnce(() => new Promise((resolve) => { finishDetection = resolve; }));
    await f.camera.start(f.video); f.camera.stop();
    finishDetection([{ rawValue: "late-frame-after-leaving" }]);
    await vi.advanceTimersByTimeAsync(0); expect(f.scan).toHaveBeenCalledTimes(3);
  });
  it("uses ZXing without BarcodeDetector and does not show unsupported torch", async () => {
    vi.useFakeTimers(); const f = fixture();
    f.fallback.decode.mockResolvedValue("khidi://sku/KH-000001");
    await f.camera.start(f.video); await vi.advanceTimersByTimeAsync(0);
    expect(f.scan).toHaveBeenCalledWith("khidi://sku/KH-000001");
    expect(f.states.at(-1)).toMatchObject({ running: true, torchAvailable: false });
    await f.camera.toggleTorch(); expect(f.track.applyConstraints).not.toHaveBeenCalled();
    f.camera.stop(); expect(f.fallback.reset).toHaveBeenCalledTimes(1);
  });
  it("falls back when the native implementation fails during decoding", async () => {
    vi.useFakeTimers();
    class Broken { static async getSupportedFormats() { return ["qr_code"]; } async detect(): Promise<never> { throw new Error("Unsupported backend"); } }
    const f = fixture(Broken); f.fallback.decode.mockResolvedValue("fallback-code");
    await f.camera.start(f.video); await vi.advanceTimersByTimeAsync(0);
    expect(f.scan).toHaveBeenCalledWith("fallback-code"); expect(f.env.loadFallback).toHaveBeenCalledTimes(1);
    f.camera.stop();
  });
  it("supplements a partial native implementation with ZXing's remaining formats", async () => {
    vi.useFakeTimers();
    class QrOnly { static async getSupportedFormats() { return ["qr_code"]; } async detect() { return []; } }
    const f = fixture(QrOnly); f.fallback.decode.mockResolvedValue("1234567890128");
    await f.camera.start(f.video); await vi.advanceTimersByTimeAsync(0);
    expect(f.scan).toHaveBeenCalledWith("1234567890128"); f.camera.stop();
  });
  it.each(["hidden", "pagehide", "ended"])("stops every track on %s and allows a deliberate restart", async (event) => {
    vi.useFakeTimers(); const f = fixture(); await f.camera.start(f.video);
    if (event === "hidden") { f.doc.hidden = true; f.doc.dispatchEvent(new Event("visibilitychange")); }
    if (event === "pagehide") f.window.dispatchEvent(new Event("pagehide"));
    if (event === "ended") f.track.dispatchEvent(new Event("ended"));
    expect(f.track.stop).toHaveBeenCalledTimes(1); expect(f.otherTrack.stop).toHaveBeenCalledTimes(1);
    expect(f.states.at(-1)?.running).toBe(false);
    f.doc.hidden = false; await f.camera.start(f.video);
    expect(f.states.at(-1)?.running).toBe(true); f.camera.stop();
  });
  it("reports denied permission, retries, and stops a stream that arrives after navigation", async () => {
    vi.useFakeTimers(); const f = fixture();
    vi.mocked(f.env.getUserMedia).mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    await f.camera.start(f.video); expect(f.states.at(-1)).toMatchObject({ issue: "permission", running: false });
    await f.camera.start(f.video); expect(f.states.at(-1)).toMatchObject({ issue: null, running: true }); f.camera.stop();
    let release!: (stream: MediaStream) => void;
    vi.mocked(f.env.getUserMedia).mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const starting = f.camera.start(f.video); f.camera.stop(); release(f.stream); await starting;
    expect(f.track.stop).toHaveBeenCalledTimes(2); expect(f.video.srcObject).toBe(null);
  });
  it("decodes actual QR frame pixels through the production ZXing video adapter", async () => {
    const text = "khidi://sku/KH-000123", size = 256;
    const matrix = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, new Map());
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (matrix.get(x, y)) pixels.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
    const draw = vi.fn();
    const context = { drawImage: draw, getImageData: () => ({ data: pixels }) };
    vi.stubGlobal("document", { createElement: () => ({ style: {}, getContext: () => context }) });
    class Video { videoWidth = size; videoHeight = size; }
    vi.stubGlobal("HTMLVideoElement", Video);
    const decoder = await loadZxingDecoder();
    const video = new Video() as HTMLVideoElement;
    // The pinned browser reader alternates normal and inverted video frames.
    expect(await decoder.decode(video) ?? await decoder.decode(video)).toBe(text);
    expect(draw).toHaveBeenCalledWith(video, 0, 0, size, size, 0, 0, size, size);
    decoder.reset();
  });
});

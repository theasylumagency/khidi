import { describe, expect, it, vi } from "vitest";
import { DEFAULT_QUALITY_CONFIG, evaluatePhotoQuality, qualityConfig } from "./quality.ts";
import { checkCapturedPhoto, PhotoCamera, type PhotoCameraEnvironment, type PhotoCameraState } from "./capture-browser.ts";
import { MAX_PHOTO_BYTES } from "./contracts.ts";

const sharpSample = () => {
  const gray = new Uint8Array(64 * 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) gray[y * 64 + x] = (x ^ y) & 1 ? 180 : 100;
  return { width: 1920, height: 1280, gray, sampleWidth: 64, sampleHeight: 64 };
};
describe("P4 offline Tier-1 checks and full-resolution camera", () => {
  it("accepts sharp detail and independently detects blur, dark/bright clipping and low resolution", () => {
    expect(evaluatePhotoQuality(sharpSample()).passed).toBe(true);
    expect(evaluatePhotoQuality({ ...sharpSample(), gray: new Uint8Array(4096).fill(128) }).reasons).toEqual(["BLUR"]);
    expect(evaluatePhotoQuality({ ...sharpSample(), gray: new Uint8Array(4096) }).reasons[0]).toBe("UNDEREXPOSED");
    expect(evaluatePhotoQuality({ ...sharpSample(), gray: new Uint8Array(4096).fill(255) }).reasons[0]).toBe("OVEREXPOSED");
    expect(evaluatePhotoQuality({ ...sharpSample(), width: 640, height: 480 }).reasons).toEqual(["RESOLUTION"]);
    expect(evaluatePhotoQuality({ ...sharpSample(), width: 640, height: 480 }, qualityConfig({ minLongEdge: 640 })).passed).toBe(true);
    expect(() => qualityConfig({ maxDarkShare: 1.1 })).toThrow();
  });
  it("checks a copy of the capture and refuses unsupported/oversized blobs before decoding", async () => {
    const bytes = new Uint8Array([255,216,255,0]), blob = new Blob([bytes], { type: "image/jpeg" });
    const sample = vi.fn(async () => sharpSample());
    expect((await checkCapturedPhoto(blob, DEFAULT_QUALITY_CONFIG, sample)).passed).toBe(true);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    await expect(checkCapturedPhoto(new Blob(["<svg/>"], { type: "image/jpeg" }), DEFAULT_QUALITY_CONFIG, sample)).rejects.toMatchObject({ reason: "UNSUPPORTED_FORMAT" });
    await expect(checkCapturedPhoto(new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)]), DEFAULT_QUALITY_CONFIG, sample)).rejects.toMatchObject({ reason: "FILE_TOO_LARGE" });
    expect(sample).toHaveBeenCalledTimes(1);
  });
  function cameraFixture() {
    const track = Object.assign(new EventTarget(), { stop: vi.fn() });
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const doc = Object.assign(new EventTarget(), { hidden: false });
    const video = { videoWidth: 4096, videoHeight: 3072, readyState: 2, srcObject: null, play: vi.fn(async () => {}), pause: vi.fn() } as unknown as HTMLVideoElement;
    const frame = new Blob([new Uint8Array([255,216,255])], { type: "image/jpeg" });
    const states: PhotoCameraState[] = [];
    const env: PhotoCameraEnvironment = { getUserMedia: vi.fn(async () => stream), document: doc, window: new EventTarget(), frame: vi.fn(async () => frame) };
    return { camera: new PhotoCamera(env, (state) => states.push(state)), env, states, video, doc, track, stream, frame };
  }
  it("uses rear muted inline video, captures actual pixels and blocks insufficient stream resolution", async () => {
    const f = cameraFixture(); await f.camera.start(f.video);
    expect(f.env.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false, video: expect.objectContaining({ facingMode: { ideal: "environment" } }) }));
    expect(f.video.muted && f.video.playsInline).toBe(true);
    expect(await f.camera.capture(1920)).toBe(f.frame); expect(f.env.frame).toHaveBeenCalledWith(f.video);
    Object.assign(f.video, { videoWidth: 640, videoHeight: 480 });
    await expect(f.camera.capture(1920)).rejects.toMatchObject({ reason: "RESOLUTION" });
    f.doc.hidden = true; f.doc.dispatchEvent(new Event("visibilitychange"));
    expect(f.track.stop).toHaveBeenCalledTimes(1); expect(f.video.srcObject).toBe(null);
  });
  it("handles denied permission/retry and stops a camera stream arriving after exit", async () => {
    const f = cameraFixture(); vi.mocked(f.env.getUserMedia).mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    await f.camera.start(f.video); expect(f.states.at(-1)?.issue).toBe("permission");
    await f.camera.start(f.video); expect(f.states.at(-1)?.running).toBe(true); f.camera.stop();
    let resolve!: (stream: MediaStream) => void;
    vi.mocked(f.env.getUserMedia).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = f.camera.start(f.video); f.camera.stop(); resolve(f.stream); await pending;
    expect(f.track.stop).toHaveBeenCalledTimes(2); expect(f.video.srcObject).toBe(null);
  });
});

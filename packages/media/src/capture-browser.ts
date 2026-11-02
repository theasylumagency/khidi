import { MAX_PHOTO_BYTES } from "./contracts.ts";
import { evaluatePhotoQuality, grayscale, type QualityConfig, type QualityReason } from "./quality.ts";
import { sniffPhotoMime } from "./formats.ts";

export class PhotoCaptureError extends Error {
  constructor(readonly reason: QualityReason | "UNSUPPORTED_FORMAT" | "FILE_TOO_LARGE") { super(reason); }
}
export interface PhotoSample { width: number; height: number; gray: Uint8Array; sampleWidth: number; sampleHeight: number }
async function sampleBrowserPhoto(blob: Blob): Promise<PhotoSample> {
  let source: CanvasImageSource, width: number, height: number, release = () => {};
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      source = bitmap; width = bitmap.width; height = bitmap.height; release = () => bitmap.close();
    } else {
      const url = URL.createObjectURL(blob), image = new Image(); release = () => URL.revokeObjectURL(url);
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = url; });
      source = image; width = image.naturalWidth; height = image.naturalHeight;
    }
    if (!width || !height || width * height > 64_000_000) throw new PhotoCaptureError("UNSUPPORTED_FORMAT");
    const scale = Math.min(1, 256 / Math.max(width, height)), canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas unavailable.");
    context.fillStyle = "#f5f5f4"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return { width, height, gray: grayscale(context.getImageData(0, 0, canvas.width, canvas.height).data), sampleWidth: canvas.width, sampleHeight: canvas.height };
  } catch (error) { if (error instanceof PhotoCaptureError) throw error; throw new PhotoCaptureError("UNSUPPORTED_FORMAT"); }
  finally { release(); }
}
export async function checkCapturedPhoto(blob: Blob, config: QualityConfig, sample = sampleBrowserPhoto) {
  if (!blob.size || blob.size > MAX_PHOTO_BYTES) throw new PhotoCaptureError("FILE_TOO_LARGE");
  if (!sniffPhotoMime(new Uint8Array(await blob.slice(0, 12).arrayBuffer()))) throw new PhotoCaptureError("UNSUPPORTED_FORMAT");
  const quality = evaluatePhotoQuality(await sample(blob), config);
  if (!quality.passed) throw new PhotoCaptureError(quality.reasons[0]!);
  return quality;
}
export interface PhotoCameraState { running: boolean; starting: boolean; width: number; height: number; issue: "permission" | "unavailable" | null }
export interface PhotoCameraEnvironment {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  frame(video: HTMLVideoElement): Promise<Blob>;
  document: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
}
export class PhotoCamera {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private generation = 0;
  constructor(private readonly env: PhotoCameraEnvironment, private readonly changed: (state: PhotoCameraState) => void) {}
  private readonly hide = () => { if (this.env.document.hidden) this.stop(); };
  private readonly leave = () => this.stop();
  async start(video: HTMLVideoElement) {
    this.stop(); if (this.env.document.hidden) return;
    const generation = this.generation;
    this.changed({ running: false, starting: true, width: 0, height: 0, issue: null });
    this.env.document.addEventListener("visibilitychange", this.hide); this.env.window.addEventListener("pagehide", this.leave);
    try {
      const stream = await this.env.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 4096 }, height: { ideal: 3072 } } });
      if (generation !== this.generation || this.env.document.hidden) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream; this.video = video; video.muted = true; video.playsInline = true; video.srcObject = stream;
      for (const track of stream.getTracks()) track.addEventListener("ended", this.leave);
      await video.play();
      if (generation === this.generation) this.changed({ running: true, starting: false, width: video.videoWidth, height: video.videoHeight, issue: null });
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop(); this.changed({ running: false, starting: false, width: 0, height: 0, issue: error instanceof Error && error.name === "NotAllowedError" ? "permission" : "unavailable" });
    }
  }
  async capture(minLongEdge: number) {
    const video = this.video;
    if (!video || video.readyState < 2 || Math.max(video.videoWidth, video.videoHeight) < minLongEdge) throw new PhotoCaptureError("RESOLUTION");
    return this.env.frame(video);
  }
  stop() {
    this.generation++;
    this.env.document.removeEventListener("visibilitychange", this.hide); this.env.window.removeEventListener("pagehide", this.leave);
    for (const track of this.stream?.getTracks() ?? []) { track.removeEventListener("ended", this.leave); track.stop(); }
    this.stream = null; if (this.video) { this.video.pause(); this.video.srcObject = null; this.video = null; }
    this.changed({ running: false, starting: false, width: 0, height: 0, issue: null });
  }
}
export function browserPhotoCamera(changed: (state: PhotoCameraState) => void) {
  return new PhotoCamera({ document, window,
    getUserMedia: (constraints) => navigator.mediaDevices?.getUserMedia(constraints) ?? Promise.reject(new Error("Camera unavailable.")),
    frame: (video) => {
      const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const context = canvas.getContext("2d"); if (!context) return Promise.reject(new Error("Canvas unavailable."));
      context.drawImage(video, 0, 0);
      return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Capture failed.")), "image/jpeg", .95));
    }
  }, changed);
}

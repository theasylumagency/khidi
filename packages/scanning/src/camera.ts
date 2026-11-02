/** Browser-only camera controller. Frames stay on the device; only decoded text leaves it. */
export const SCAN_FORMATS = ["ean_8", "ean_13", "upc_a", "upc_e", "code_128", "code_39", "qr_code", "data_matrix"] as const;
export type CameraIssue = "permission" | "unavailable" | "interrupted";
export interface FrameDecoder { decode(video: HTMLVideoElement): Promise<string | null>; reset(): void }
export interface NativeDetector {
  detect(video: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
export interface DetectorConstructor {
  new(options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}
export interface CameraState { running: boolean; starting: boolean; torchAvailable: boolean; torchOn: boolean; issue: CameraIssue | null }
export interface CameraEnvironment {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  detector?: DetectorConstructor;
  loadFallback(): Promise<FrameDecoder>;
  document: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
}

/** Kept out of the initial scanner bundle, including on browsers with a native decoder. */
export async function loadZxingDecoder(): Promise<FrameDecoder> {
  const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType, NotFoundException, ChecksumException, FormatException } = await import("@zxing/library");
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_8, BarcodeFormat.EAN_13,
    BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX]]]);
  const reader = new BrowserMultiFormatReader(hints);
  let width = 0, height = 0;
  return {
    async decode(video) {
      if (video.videoWidth !== width || video.videoHeight !== height) {
        reader.reset(); width = video.videoWidth; height = video.videoHeight;
      }
      try { return reader.decode(video).getText(); }
      catch (error) {
        if (error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException) return null;
        throw error;
      }
    },
    reset: () => reader.reset()
  };
}

export function browserCameraEnvironment(): CameraEnvironment {
  const detector = (globalThis as typeof globalThis & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
  // On iPhone, warm the decoder chunk while the authenticated scanner is online.
  // Its normal static-asset cache then also serves an already-open offline scanner.
  if (!detector) void import("@zxing/library").catch(() => {});
  return { getUserMedia: (constraints) => {
    if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error("Camera unavailable."));
    return navigator.mediaDevices.getUserMedia(constraints);
  }, detector,
  loadFallback: loadZxingDecoder, document, window };
}

export class ScannerCamera {
  private generation = 0;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private decoder: FrameDecoder | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastValue: string | null = null;
  private lastSeen = 0;
  private torchBusy = false;
  private state: CameraState = { running: false, starting: false, torchAvailable: false, torchOn: false, issue: null };
  constructor(private readonly environment: CameraEnvironment, private readonly onScan: (value: string) => Promise<boolean>,
    private readonly changed: (state: CameraState) => void) {}
  private update(patch: Partial<CameraState>) { this.state = { ...this.state, ...patch }; this.changed(this.state); }
  private readonly hidden = () => { if (this.environment.document.hidden) this.stop(); };
  private readonly leaving = () => this.stop();
  private readonly ended = () => { this.stop(); this.update({ issue: "interrupted" }); };

  async start(video: HTMLVideoElement) {
    this.stop();
    const generation = this.generation;
    const live = () => generation === this.generation && !this.environment.document.hidden;
    this.video = video;
    this.update({ starting: true, issue: null });
    this.environment.document.addEventListener("visibilitychange", this.hidden);
    this.environment.window.addEventListener("pagehide", this.leaving);
    try {
      const stream = await this.environment.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (!live()) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("No video track.");
      track.addEventListener("ended", this.ended);
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      await video.play();
      if (!live()) return;
      let native: NativeDetector | null = null;
      let supplementNative = false;
      if (this.environment.detector) {
        try {
          const supported = await this.environment.detector.getSupportedFormats();
          const formats = SCAN_FORMATS.filter((format) => supported.includes(format));
          if (formats.length) {
            native = new this.environment.detector({ formats });
            supplementNative = formats.length < SCAN_FORMATS.length;
          }
        } catch { /* An exposed but unavailable native implementation uses ZXing. */ }
      }
      if (!native || supplementNative) {
        const fallback = await this.environment.loadFallback();
        if (!live()) { fallback.reset(); return; }
        this.decoder = fallback;
      }
      if (!live()) return;
      const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean } | undefined;
      this.update({ starting: false, running: true, torchAvailable: capabilities?.torch === true });
      const tick = async () => {
        if (!live()) return;
        try {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            let value: string | null = null;
            if (native) {
              try { value = (await native.detect(video))[0]?.rawValue ?? null; if (!live()) return; }
              catch {
                if (!live()) return;
                native = null;
                if (!this.decoder) {
                  const fallback = await this.environment.loadFallback();
                  if (!live()) { fallback.reset(); return; }
                  this.decoder = fallback;
                }
              }
            }
            if (!value && this.decoder) value = await this.decoder.decode(video);
            if (!live()) return;
            const now = Date.now();
            if (value) {
              // A stationary label produces many frames, but only one physical scan.
              const fresh = value !== this.lastValue || now - this.lastSeen >= 800;
              this.lastSeen = now;
              if (fresh) {
                const stored = await this.onScan(value);
                if (live() && stored) this.lastValue = value;
              }
            }
          }
          if (live()) this.timer = setTimeout(() => { void tick(); }, 120);
        } catch { if (live()) { this.stop(); this.update({ issue: "unavailable" }); } }
      };
      void tick();
    } catch (error) {
      if (live()) {
        this.stop();
        this.update({ issue: error instanceof Error && ["NotAllowedError", "SecurityError"].includes(error.name) ? "permission" : "unavailable" });
      }
    }
  }

  async toggleTorch() {
    if (!this.state.torchAvailable || this.torchBusy) return;
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    const generation = this.generation, enabled = !this.state.torchOn;
    this.torchBusy = true;
    try {
      await track.applyConstraints({ advanced: [{ torch: enabled } as MediaTrackConstraintSet] });
      if (generation === this.generation) this.update({ torchOn: enabled });
    } catch { if (generation === this.generation) this.update({ torchAvailable: false, torchOn: false }); }
    finally { this.torchBusy = false; }
  }

  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.environment.document.removeEventListener("visibilitychange", this.hidden);
    this.environment.window.removeEventListener("pagehide", this.leaving);
    for (const track of this.stream?.getTracks() ?? []) { track.removeEventListener("ended", this.ended); track.stop(); }
    this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video = null; }
    this.decoder?.reset(); this.decoder = null;
    this.lastValue = null; this.lastSeen = 0;
    this.update({ running: false, starting: false, torchAvailable: false, torchOn: false });
  }
}

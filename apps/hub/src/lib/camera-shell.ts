/** Presentation lifecycle only. No scan, intake or upload logic. */
export interface CameraShellEnvironment {
  document: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
  history: Pick<History, "state" | "pushState" | "back">;
  lockScroll(): () => void;
  requestWakeLock?: () => Promise<{ release(): Promise<void> }>;
}
export class CameraShellLifecycle {
  private active = false;
  private generation = 0;
  private wake: { release(): Promise<void> } | null = null;
  private restoreScroll?: () => void;
  constructor(private readonly env: CameraShellEnvironment, private readonly token: string,
    private readonly stopTracks: () => void, private readonly closed: () => void) {}
  open() {
    if (this.active) return;
    this.active = true;
    this.env.history.pushState({ ...this.env.history.state, khidiCamera: this.token }, "");
    this.restoreScroll = this.env.lockScroll();
    this.env.window.addEventListener("popstate", this.back);
    this.env.window.addEventListener("pagehide", this.leave);
    this.env.document.addEventListener("visibilitychange", this.visibility);
    void this.acquireWake();
  }
  private async acquireWake() {
    if (!this.active || this.env.document.hidden || this.wake) return;
    const generation = ++this.generation;
    try {
      const wake = await this.env.requestWakeLock?.();
      if (!wake) return;
      if (!this.active || this.env.document.hidden || generation !== this.generation) await wake.release();
      else this.wake = wake;
    } catch { /* Wake Lock is optional; denied/unsupported must not block the camera. */ }
  }
  private releaseWake() { this.generation++; const wake = this.wake; this.wake = null; if (wake) void wake.release().catch(() => {}); }
  private visibility = () => { if (this.env.document.hidden) { this.stopTracks(); this.releaseWake(); } else void this.acquireWake(); };
  private back = () => this.close(false);
  private leave = () => this.close(false);
  close(removeHistory = true) {
    if (!this.active) return;
    this.active = false;
    this.stopTracks(); this.releaseWake();
    this.env.window.removeEventListener("popstate", this.back);
    this.env.window.removeEventListener("pagehide", this.leave);
    this.env.document.removeEventListener("visibilitychange", this.visibility);
    this.restoreScroll?.(); this.restoreScroll = undefined;
    if (removeHistory && this.env.history.state?.khidiCamera === this.token) this.env.history.back();
    this.closed();
  }
}
export function containBounds(width: number, height: number, sourceWidth: number, sourceHeight: number) {
  if (![width, height, sourceWidth, sourceHeight].every((v) => Number.isFinite(v) && v > 0)) return null;
  const scale = Math.min(width / sourceWidth, height / sourceHeight), w = sourceWidth * scale, h = sourceHeight * scale;
  return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
}
export function scanFeedback(result: "accepted" | "duplicate" | "review", device: { vibrate?: (pattern: number[]) => boolean }) {
  try { device.vibrate?.(result === "accepted" ? [45] : result === "duplicate" ? [25, 60, 25] : [100, 60, 100]); } catch { /* Visual feedback is sufficient on iPhone. */ }
}

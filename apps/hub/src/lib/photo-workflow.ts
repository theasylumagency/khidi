import { PhotoCaptureError } from "@khidi/media/capture-browser";
import type { CaptureSlot, PhotoSlot } from "@khidi/media/contracts";
import type { QualityReport } from "@khidi/media/quality";

export interface CapturedPhoto { blob: Blob; slot: PhotoSlot; capturedAt: string; quality: QualityReport }
export interface SavedPhoto { key: string; blob: Blob; slot: PhotoSlot }
interface WorkflowState {
  current: PhotoSlot | null; accepted: PhotoSlot[]; saved: SavedPhoto[];
  phase: "idle" | "checking" | "saving";
  failure: PhotoCaptureError["reason"] | "storage" | null;
  candidate: Blob | null; retryable: boolean;
}
/** Presentation only: the queue remains the authority for durable storage and delivery. */
export class PhotoWorkflow {
  private slots: CaptureSlot[];
  private candidate: CapturedPhoto | null = null;
  private listeners = new Set<() => void>();
  private state: WorkflowState;
  constructor(slots: CaptureSlot[], accepted: PhotoSlot[], private readonly actions: {
    check: (blob: Blob) => Promise<QualityReport>;
    save: (photo: CapturedPhoto) => Promise<string>;
    taken: () => void;
  }) {
    this.slots = slots;
    this.state = { current: this.next(accepted), accepted, saved: [], phase: "idle", failure: null, candidate: null, retryable: false };
  }
  private next(accepted: PhotoSlot[]) { return (this.slots.find((slot) => slot.required && !accepted.includes(slot.slot)) ?? this.slots[0])?.slot ?? null; }
  readonly snapshot = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<WorkflowState>) { this.state = { ...this.state, ...change }; this.listeners.forEach((listener) => listener()); }
  configure(slots: CaptureSlot[], accepted: PhotoSlot[]) {
    this.slots = slots;
    const combined = [...new Set([...accepted, ...this.state.saved.map((photo) => photo.slot)])];
    // Preserve a selected retake or in-flight slot when server context refreshes.
    const current = slots.some((slot) => slot.slot === this.state.current) ? this.state.current : this.next(combined);
    this.update({ accepted: combined, current });
  }
  select(slot: PhotoSlot) {
    if (this.state.phase !== "idle" || !this.slots.some((item) => item.slot === slot)) return;
    this.candidate = null; this.update({ current: slot, candidate: null, failure: null, retryable: false });
  }
  async receive(blob: Blob | null) {
    if (!blob || !this.state.current || this.state.phase !== "idle") return;
    const slot = this.state.current, capturedAt = new Date().toISOString();
    this.actions.taken(); this.candidate = null;
    this.update({ phase: "checking", candidate: blob, failure: null, retryable: false });
    try { this.candidate = { blob, slot, capturedAt, quality: await this.actions.check(blob) }; }
    catch (error) { this.update({ phase: "idle", failure: error instanceof PhotoCaptureError ? error.reason : "UNSUPPORTED_FORMAT" }); return; }
    await this.persist();
  }
  async retry() { if (this.state.phase === "idle" && this.candidate) await this.persist(); }
  async recordAbsentEnginePlate(save:()=>Promise<void>) {
    if(this.state.current!=="ENGINE_IDENTIFICATION"||this.state.phase!=="idle")return;
    this.update({phase:"saving",failure:null});
    try {
      await save();const accepted=[...new Set([...this.state.accepted,"ENGINE_IDENTIFICATION" as const])];
      this.update({phase:"idle",accepted,current:this.slots.find(slot=>slot.required&&!accepted.includes(slot.slot))?.slot??"ENGINE_IDENTIFICATION"});
    }catch(error){this.update({phase:"idle",failure:"storage"});throw error;}
  }
  private async persist() {
    const photo = this.candidate!;
    this.update({ phase: "saving", failure: null, retryable: false });
    let key: string;
    try { key = await this.actions.save(photo); }
    catch { this.update({ phase: "idle", failure: "storage", retryable: true }); return; }
    const accepted = [...new Set([...this.state.accepted, photo.slot])];
    const saved = [...this.state.saved.filter((item) => item.slot !== photo.slot), { key, blob: photo.blob, slot: photo.slot }];
    this.candidate = null;
    // Do not advance until the IndexedDB transaction has committed.
    this.update({ phase: "idle", accepted, saved, current: this.slots.find((slot) => slot.required && !accepted.includes(slot.slot))?.slot ?? photo.slot, candidate: null, retryable: false });
  }
}

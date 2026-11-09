import { describe, expect, it, vi } from "vitest";
import { PhotoCaptureError } from "@khidi/media/capture-browser";
import type { CaptureSlot } from "@khidi/media/contracts";
import type { QualityReport } from "@khidi/media/quality";
import { PhotoWorkflow, type CapturedPhoto } from "./photo-workflow.ts";
const slots: CaptureSlot[] = [{ slot: "IDENTIFICATION", required: true }, { slot: "EXTRA", required: false }, { slot: "MAIN", required: true }];
const quality: QualityReport = { passed: true, reasons: [], width: 2400, height: 1600, variance: 100, darkShare: 0, brightShare: 0 };
const blob = new Blob(["original camera bytes"], { type: "image/jpeg" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
describe("native/picker auto-save photo workflow", () => {
  it("records checked absence durably before resolving the engine step and stores no pretend photo",async()=>{
    const committed=deferred<void>(),workflow=new PhotoWorkflow([{slot:"ENGINE_IDENTIFICATION",required:true},{slot:"MAIN",required:true}],[],{check:async()=>quality,save:async()=>"photo",taken:()=>{}});
    const saving=workflow.recordAbsentEnginePlate(()=>committed.promise);expect(workflow.snapshot()).toMatchObject({phase:"saving",accepted:[],saved:[]});
    committed.resolve();await saving;expect(workflow.snapshot()).toMatchObject({current:"MAIN",accepted:["ENGINE_IDENTIFICATION"],saved:[],phase:"idle"});
  });
  it("does not resolve a plate when observation storage fails",async()=>{
    const workflow=new PhotoWorkflow([{slot:"ENGINE_IDENTIFICATION",required:true}],[],{check:async()=>quality,save:async()=>"photo",taken:()=>{}});
    await expect(workflow.recordAbsentEnginePlate(async()=>{throw new Error("Storage unavailable");})).rejects.toThrow();expect(workflow.snapshot()).toMatchObject({accepted:[],saved:[],phase:"idle",failure:"storage"});
  });
  it("checks then persists once, advancing only after durable storage, in configured required order", async () => {
    const checked = deferred<QualityReport>(), committed = deferred<string>();
    const save = vi.fn(() => committed.promise), workflow = new PhotoWorkflow(slots, [], { check: () => checked.promise, save, taken: () => {} });
    const receiving = workflow.receive(blob);
    expect(workflow.snapshot()).toMatchObject({ current: "IDENTIFICATION", phase: "checking", accepted: [] });
    expect(save).not.toHaveBeenCalled();
    await workflow.receive(blob); // a second input event cannot race an in-flight capture
    checked.resolve(quality); await Promise.resolve();
    expect(workflow.snapshot()).toMatchObject({ current: "IDENTIFICATION", phase: "saving", accepted: [] });
    committed.resolve("durable-key"); await receiving;
    expect(save).toHaveBeenCalledExactlyOnceWith({ blob, slot: "IDENTIFICATION", quality, capturedAt: expect.any(String) });
    expect(workflow.snapshot()).toMatchObject({ current: "MAIN", phase: "idle", accepted: ["IDENTIFICATION"], candidate: null });
  });
  it("cancelled native camera/gallery changes neither step, accepted count nor a failed-save candidate", async () => {
    const save = vi.fn(async () => { throw new Error("quota"); }), taken = vi.fn();
    const workflow = new PhotoWorkflow(slots, [], { check: async () => quality, save, taken });
    const initial = workflow.snapshot(); await workflow.receive(null); expect(workflow.snapshot()).toBe(initial);
    await workflow.receive(blob); const failed = workflow.snapshot(); await workflow.receive(null);
    expect(workflow.snapshot()).toBe(failed); expect(taken).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledOnce();
  });
  it("retains the checked original and slot on storage failure; retry saves the same capture without rechecking", async () => {
    let fail = true; const check = vi.fn(async () => quality), attempts: CapturedPhoto[] = [];
    const workflow = new PhotoWorkflow(slots, [], { check, taken: () => {}, save: async (photo) => { attempts.push(photo); if (fail) throw new Error("transaction aborted"); return "saved"; } });
    await workflow.receive(blob);
    expect(workflow.snapshot()).toMatchObject({ current: "IDENTIFICATION", accepted: [], candidate: blob, failure: "storage", retryable: true });
    fail = false; await workflow.retry();
    expect(attempts[1]).toBe(attempts[0]); expect(check).toHaveBeenCalledOnce();
    expect(workflow.snapshot()).toMatchObject({ current: "MAIN", accepted: ["IDENTIFICATION"], failure: null, candidate: null });
  });
  it("quality failure preserves the current step and does not enqueue; a new gallery/native result can succeed", async () => {
    let blurry = true; const save = vi.fn(async () => "saved");
    const workflow = new PhotoWorkflow(slots, [], { check: async () => { if (blurry) throw new PhotoCaptureError("BLUR"); return quality; }, save, taken: () => {} });
    await workflow.receive(blob); await workflow.retry();
    expect(workflow.snapshot()).toMatchObject({ current: "IDENTIFICATION", accepted: [], failure: "BLUR", retryable: false }); expect(save).not.toHaveBeenCalled();
    blurry = false; await workflow.receive(blob); expect(workflow.snapshot().current).toBe("MAIN");
  });
  it("retakes append new candidates without increasing the unique-slot count or replacing persisted originals", async () => {
    const stored: CapturedPhoto[] = [];
    const workflow = new PhotoWorkflow(slots, [], { check: async () => quality, taken: () => {}, save: async (photo) => { stored.push(photo); return `candidate-${stored.length}`; } });
    await workflow.receive(blob); workflow.select("IDENTIFICATION");
    const replacement = new Blob(["new bytes"]); await workflow.receive(replacement);
    expect(stored).toHaveLength(2); expect(stored[0]!.blob).toBe(blob); expect(stored[1]!.blob).toBe(replacement);
    expect(workflow.snapshot().accepted).toEqual(["IDENTIFICATION"]); expect(workflow.snapshot().current).toBe("MAIN");
    expect(workflow.snapshot().saved[0]!.key).toBe("candidate-2");
  });
  it("keeps locally committed required/optional progress across stale offline server context", async () => {
    const workflow = new PhotoWorkflow(slots, [], { check: async () => quality, taken: () => {}, save: async () => "local-key" });
    await workflow.receive(blob); workflow.configure(slots, []); // stale server context while offline
    expect(workflow.snapshot()).toMatchObject({ current: "MAIN", accepted: ["IDENTIFICATION"] });
    await workflow.receive(blob); expect(workflow.snapshot().accepted).toEqual(["IDENTIFICATION", "MAIN"]);
    workflow.select("EXTRA"); await workflow.receive(blob);
    expect(workflow.snapshot().accepted).toEqual(["IDENTIFICATION", "MAIN", "EXTRA"]);
  });
});

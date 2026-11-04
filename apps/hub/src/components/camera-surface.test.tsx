import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DEFAULT_QUALITY_CONFIG } from "@khidi/media/quality";
import { GuidedPhotoCapture } from "./guided-photo-capture.tsx";
import { WarehouseScanner } from "./warehouse-scanner.tsx";
vi.mock("./scan-queue-provider.tsx", () => ({ useScanQueue: () => ({ ready: true, photos: [], photoVersion: 0, usage: null }) }));
it("renders a modal scanner with a full-surface cover video, manual fallback and conditional torch", () => {
  const html = renderToStaticMarkup(createElement(WarehouseScanner));
  expect(html).toContain('<dialog'); expect(html).toContain('camera-scanner'); expect(html).toContain('object-fit:cover');
  expect(html).toContain('playsInline'); expect(html).toContain('muted');
  expect(html).toContain('კოდის ხელით შეყვანა'); expect(html).not.toContain('aria-pressed');
  expect(html).toContain('მოათავსეთ ბარკოდი ჩარჩოში'); expect(html).toContain('სკანირება ავტომატურად მოხდება.');
});
it("offers only native camera/picker auto-save, with configured steps and no second acceptance", () => {
  const html = renderToStaticMarkup(createElement(GuidedPhotoCapture, {
    slots: [{ slot: "MAIN", required: true }], acceptedSlots: [], qualityConfig: DEFAULT_QUALITY_CONFIG,
    onAccept: async () => "photo-key", onCannotPhotograph: async () => {}, onComplete: () => {}
  }));
  expect(html).toContain('კამერის გახსნა'); expect(html).toContain('capture="environment"');
  expect(html).toContain('accept="image/jpeg"'); expect(html).toContain('image/png,image/webp');
  expect(html).toContain('შენახული ფოტოები: 0 / 1'); expect(html).toContain('ფოტოს არჩევა გალერიიდან');
  expect(html).not.toContain('<video'); expect(html).not.toContain('ფოტოს მიღება'); expect(html).not.toContain('camera-photo-slots');
  expect(html).not.toContain('შემდეგი პროდუქტის სკანირება');
});
it("does not claim server receipt for a queued retake of an already uploaded slot", () => {
  const html = renderToStaticMarkup(createElement(GuidedPhotoCapture, {
    slots: [{ slot: "IDENTIFICATION", required: true, titleKa: "სერიული ნომერი", guidanceKa: "ნომერი მკაფიოდ ჩანდეს." }],
    acceptedSlots: ["IDENTIFICATION"], syncedSlots: ["IDENTIFICATION"],
    queuedPhotos: [{ key: "retake", slot: "IDENTIFICATION", blob: new Blob(["queued"]), blocked: false }], qualityConfig: DEFAULT_QUALITY_CONFIG,
    onAccept: async () => "photo-key", onCannotPhotograph: async () => {}, onComplete: () => {}
  }));
  expect(html).toContain('სერიული ნომერი'); expect(html).toContain('ნომერი მკაფიოდ ჩანდეს.'); expect(html).toContain('შენახული ფოტოები: 1 / 1');
  expect(html).toContain('მოწყობილობაზეა · გასაგზავნია'); expect(html).not.toContain('სერვერმა მიიღო');
  expect(html).toContain('ხელახლა გადაღება: სერიული ნომერი'); expect(html).toContain('შემდეგი პროდუქტის სკანირება');
});
it.each([false, true])("distinguishes blocked local photos from a matching server receipt (receipt=%s)", (received) => {
  const html = renderToStaticMarkup(createElement(GuidedPhotoCapture, {
    slots: [{ slot: "EXTRA", required: false }], acceptedSlots: ["EXTRA"],
    queuedPhotos: [{ key: "photo", slot: "EXTRA", blob: new Blob(["queued"]), blocked: !received }],
    photoReceipts: new Set(received ? ["photo"] : []), qualityConfig: DEFAULT_QUALITY_CONFIG,
    onAccept: async () => "key", onCannotPhotograph: async () => {}, onComplete: () => {}
  }));
  expect(html).toContain(received ? '✓ სერვერმა მიიღო' : 'მოწყობილობაზეა · საჭიროა შემოწმება');
  if (!received) expect(html).not.toContain('სერვერმა მიიღო');
});

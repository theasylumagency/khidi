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
});
it("renders uncropped photo pixels with native JPEG capture, picker and required-slot gating", () => {
  const html = renderToStaticMarkup(createElement(GuidedPhotoCapture, {
    slots: [{ slot: "MAIN", required: true }], acceptedSlots: [], qualityConfig: DEFAULT_QUALITY_CONFIG,
    onAccept: async () => {}, onCannotPhotograph: async () => {}, onComplete: () => {}
  }));
  expect(html).toContain('object-fit:contain'); expect(html).toContain('capture="environment"');
  expect(html).toContain('accept="image/jpeg"'); expect(html).toContain('image/png,image/webp');
  expect(html).not.toContain('შემდეგი პროდუქტის სკანირება');
});

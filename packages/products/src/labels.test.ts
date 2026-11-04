import { describe, expect, it } from "vitest";
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";
import { buildThermalLabelBatchHtml, buildThermalLabelSpec, renderInternalQrSvg } from "./labels.ts";

describe("M3 S3 printable labels", () => {
  it.each([
    { kind: "internal label", payload: "khidi://sku/KH-000123" },
    { kind: "TOTP enrollment", payload: "otpauth://totp/Khidi:fixture%40khidi.example?issuer=Khidi&secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30" }
  ])("decodes the actual $kind SVG back to the exact payload", ({ payload }) => {
    const svg = renderInternalQrSvg(payload);
    const modules = Number(svg.match(/viewBox="0 0 (\d+)/)![1]);
    const scale = 6;
    const width = modules * scale;
    const pixels = new Uint8ClampedArray(width * width).fill(255);
    for (const rect of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1"/g)) {
      const x = Number(rect[1]) * scale, y = Number(rect[2]) * scale;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) pixels[(y + dy) * width + x + dx] = 0;
    }
    const image = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, width)));
    expect(new QRCodeReader().decode(image).getText()).toBe(payload);
  });
  it("escapes unverified product text and paginates the existing 58 × 40 mm template", () => {
    const label = { internalSku: "KH-000123", qrValue: "khidi://sku/KH-000123", titleKa: '<img src=x onerror="alert(1)">', brand: "<script>bad()</script>", modelCode: 'A&B' };
    const single = buildThermalLabelSpec(label);
    expect(single.printableHtml).not.toContain("<script>");
    expect(single.printableHtml).not.toContain("<img");
    expect(single.printableHtml).toContain("A&amp;B");
    const batch = buildThermalLabelBatchHtml([label, { ...label, internalSku: "KH-000124" }]);
    expect(batch).toContain("size: 58mm 40mm");
    expect(batch.match(/class="thermal-label"/g)).toHaveLength(2);
    expect(batch).toContain("break-after: page");
  });
});

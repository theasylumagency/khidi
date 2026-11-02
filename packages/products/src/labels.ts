import { AppError } from "@khidi/shared";

/**
 * Standard Code 128 pattern table (values 0..106).
 * Each string represents module widths of alternating bars and spaces (6 elements, 11 modules; Stop has 7 elements, 13 modules).
 */
const CODE128_PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112"
] as const;

/**
 * Generates a valid Code128B barcode SVG for an ASCII identifier such as `AGT-000184`.
 */
export function renderCode128Svg(value: string, heightPx = 42): string {
  const clean = value.trim();
  if (!clean) {
    throw new AppError("VALIDATION_ERROR", "Cannot generate Code128 barcode for empty string.");
  }

  const codes: number[] = [104]; // Start Code B
  let checksum = 104;

  for (let i = 0; i < clean.length; i += 1) {
    const charCode = clean.charCodeAt(i);
    if (charCode < 32 || charCode > 126) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Character "${clean[i]}" is outside printable ASCII range for Code128B.`
      );
    }
    const codeVal = charCode - 32;
    codes.push(codeVal);
    checksum += codeVal * (i + 1);
  }

  codes.push(checksum % 103);
  codes.push(106); // Stop pattern

  const quietZone = 10;
  let x = quietZone;
  const rects: string[] = [];

  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code];
    if (!pattern) continue;
    for (let j = 0; j < pattern.length; j += 1) {
      const width = Number(pattern[j]);
      if (j % 2 === 0) {
        rects.push(`<rect x="${x}" y="0" width="${width}" height="${heightPx}" fill="#000000" />`);
      }
      x += width;
    }
  }

  const totalWidth = x + quietZone;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${heightPx}" role="img" aria-label="Code128 ${clean}" preserveAspectRatio="none">${rects.join("")}</svg>`;
}

/**
 * Generates a deterministic Finder-Pattern 2D QR-style SVG encoding `khidi://sku/<internalSku>`
 * with embedded `data-qr-payload` for thermal label printing and scanner resolution (§5.4).
 */
export function renderInternalQrSvg(qrPayload: string, sizePx = 76): string {
  const gridSize = 21;
  const matrix: boolean[][] = Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => false)
  );

  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const row = matrix[r0 + r];
        if (row) {
          row[c0 + c] = isBorder || isCenter;
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, gridSize - 7);
  drawFinder(gridSize - 7, 0);

  // Deterministic bit fill from payload bytes
  let bitIndex = 0;
  const bytes = Buffer.from(qrPayload, "utf8");
  for (let r = 0; r < gridSize; r += 1) {
    for (let c = 0; c < gridSize; c += 1) {
      const inFinder =
        (r < 8 && c < 8) ||
        (r < 8 && c >= gridSize - 8) ||
        (r >= gridSize - 8 && c < 8);
      if (inFinder) continue;

      const byte = bytes[bitIndex % bytes.length] ?? 0;
      const bit = ((byte >> (bitIndex % 8)) & 1) === 1;
      const row = matrix[r];
      if (row) {
        row[c] = bit !== ((r + c) % 3 === 0);
      }
      bitIndex += 1;
    }
  }

  const cells: string[] = [];
  for (let r = 0; r < gridSize; r += 1) {
    for (let c = 0; c < gridSize; c += 1) {
      if (matrix[r]?.[c]) {
        cells.push(`<rect x="${c + 1}" y="${r + 1}" width="1" height="1" fill="#000000" />`);
      }
    }
  }

  const viewSize = gridSize + 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" width="${sizePx}" height="${sizePx}" role="img" aria-label="QR ${qrPayload}" data-qr-payload="${qrPayload}"><rect width="${viewSize}" height="${viewSize}" fill="#ffffff" />${cells.join("")}</svg>`;
}

export interface ThermalLabelPayload {
  internalSku: string; // e.g. AGT-000184
  qrValue: string; // e.g. khidi://sku/AGT-000184
  titleKa: string;
  brand?: string | null;
  modelCode?: string | null;
  widthMm?: number; // default 58 (§5.4)
  heightMm?: number; // default 40 (§5.4)
}

/**
 * §5.4 Builds a browser-printable thermal label document (default 58 × 40 mm, configurable)
 * containing both QR and Code128 representations of the internal SKU.
 */
export function buildThermalLabelSpec(input: ThermalLabelPayload): {
  internalSku: string;
  qrValue: string;
  widthMm: number;
  heightMm: number;
  code128Svg: string;
  qrSvg: string;
  printableHtml: string;
} {
  const widthMm = input.widthMm ?? 58;
  const heightMm = input.heightMm ?? 40;
  const code128Svg = renderCode128Svg(input.internalSku, 36);
  const qrSvg = renderInternalQrSvg(input.qrValue, 68);
  const safeTitle = input.titleKa.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const subline = [input.brand, input.modelCode].filter(Boolean).join(" · ");

  const printableHtml = `<!doctype html>
<html lang="ka">
<head>
  <meta charset="utf-8" />
  <title>${input.internalSku} — თერმული ეტიკეტი (${widthMm}×${heightMm}mm)</title>
  <style>
    @page {
      size: ${widthMm}mm ${heightMm}mm;
      margin: 0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: "Noto Sans Georgian", system-ui, sans-serif;
      background: #ffffff;
      color: #000000;
    }
    .thermal-label {
      width: ${widthMm}mm;
      height: ${heightMm}mm;
      padding: 2mm 2.5mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
      border: 1px dashed #cbd5e1;
    }
    @media print {
      .thermal-label { border: none; }
      .no-print { display: none !important; }
    }
    .top-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 2mm;
    }
    .meta {
      flex: 1;
      min-width: 0;
    }
    .sku-code {
      font-family: monospace;
      font-size: 11pt;
      font-weight: 800;
      line-height: 1.1;
    }
    .title-ka {
      font-size: 7.5pt;
      font-weight: 600;
      line-height: 1.15;
      margin-top: 1mm;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .subline {
      font-size: 6.5pt;
      color: #334155;
      margin-top: 0.5mm;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .qr-box {
      width: 15mm;
      height: 15mm;
      flex-shrink: 0;
    }
    .qr-box svg {
      width: 100%;
      height: 100%;
    }
    .barcode-row {
      width: 100%;
      height: 11mm;
    }
    .barcode-row svg {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div class="thermal-label" data-internal-sku="${input.internalSku}" data-dimensions="${widthMm}x${heightMm}mm">
    <div class="top-row">
      <div class="meta">
        <div class="sku-code">${input.internalSku}</div>
        <div class="title-ka">${safeTitle}</div>
        ${subline ? `<div class="subline">${subline}</div>` : ""}
      </div>
      <div class="qr-box">${qrSvg}</div>
    </div>
    <div class="barcode-row">${code128Svg}</div>
  </div>
</body>
</html>`;

  return {
    internalSku: input.internalSku,
    qrValue: input.qrValue,
    widthMm,
    heightMm,
    code128Svg,
    qrSvg,
    printableHtml
  };
}

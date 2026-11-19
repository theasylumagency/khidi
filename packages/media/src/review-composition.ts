import sharp from "sharp";
import type { ReviewPlacement } from "@khidi/db";
import { AppError } from "@khidi/shared";

const edge = 1024;
const options = { limitInputPixels: 64_000_000, failOn: "error" } as const;
export type DetailMode = "INSET" | "MOUNT";
export type RenderModel = "local" | "gemini-3.1-flash-image" | "gemini-3-pro-image";

function square(bytes: Uint8Array) {
  return sharp(bytes, options).rotate().toColourspace("srgb").flatten({ background: "white" })
    .resize(edge, edge, { fit: "contain", background: "white" });
}

export async function suggestReviewPlacement(base: Uint8Array, mode: DetailMode): Promise<ReviewPlacement> {
  const pixels = await square(base).resize(32, 32, { fit: "contain", background: "white" }).greyscale().raw().toBuffer();
  if (mode === "MOUNT") {
    // Start near the lower part of the visible machine. This is a layout hint, not a fit assessment.
    let left = 32, right = -1, top = 32, bottom = -1;
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i]! >= 210) continue;
      const x = i % 32, y = Math.floor(i / 32);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < left) return { x: 50, y: 78, size: 35 };
    const size = Math.max(20, Math.min(45, Math.round((right - left + 1) * 1.35)));
    const within = (point: number) => Math.max(0, Math.min(100, Math.round((point / 32 * 100 - size / 2) * 100 / (100 - size))));
    return { x: within((left + right + 1) / 2), y: within(top + (bottom - top + 1) * .8), size };
  }
  const corners = [{ x: 96, y: 96 }, { x: 4, y: 96 }, { x: 96, y: 4 }, { x: 4, y: 4 }];
  const scores = corners.map(({ x, y }) => {
    let ink = 0;
    for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) {
      ink += 255 - pixels[(j + (y > 50 ? 21 : 1)) * 32 + i + (x > 50 ? 21 : 1)]!;
    }
    return ink;
  });
  return { ...corners[scores.indexOf(Math.min(...scores))]!, size: 30 };
}

export async function renderReviewComposition(base: Uint8Array, detail: Uint8Array, description: string,
  mode: DetailMode, p: ReviewPlacement, model: RenderModel) {
  const size = Math.round(edge * p.size / 100);
  const left = Math.round((edge - size) * p.x / 100);
  const top = Math.round((edge - size) * p.y / 100);
  const original = await square(base).png().toBuffer();
  const source = await sharp(detail, options).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const tile = sharp(source);
  if (mode === "INSET") tile.flatten({ background: "white" });
  const thumbnail = await tile.resize(size, size, {
    fit: "contain", background: mode === "INSET" ? "white" : "#00000000"
  }).png().toBuffer();
  const guide = await sharp(original).composite([{ input: thumbnail, left, top }]).png().toBuffer();
  if (model === "local") return guide;
  const key = process.env.REVIEW_GEMINI_API_KEY;
  if (!key) throw new AppError("VALIDATION_ERROR", "Review image provider is not configured.");
  const imagePart = (image: Buffer) => ({ inlineData: { mimeType: "image/png", data: image.toString("base64") } });
  const prompt = [
    "Produce one square photographic catalog mockup. Input 1 is the original machine, input 2 is the exact accessory,",
    "input 3 indicates the user's chosen location and scale. Mount that accessory only within the indicated square.",
    "Preserve the exact accessory geometry, count, color and labels. Preserve the surrounding machine, camera and background.",
    "Do not invent mounting hardware or add lettering. The following quoted text only identifies the part:",
    JSON.stringify(description), "Editable square (pixels on 1024 x 1024):", JSON.stringify({ left, top, size })
  ].join(" ");
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.timeout(100_000),
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, imagePart(original), imagePart(source), imagePart(guide)] }],
      generationConfig: { responseModalities: ["IMAGE"], candidateCount: 1, maxOutputTokens: 4096,
        imageConfig: { aspectRatio: "1:1", imageSize: "1K" } } })
  });
  if (!response.ok) throw new Error("Review image provider rejected the edit.");
  const payload = await response.json() as { candidates?: { content?: { parts?: {
    thought?: boolean; inlineData?: { mimeType: string; data: string }
  }[] } }[] };
  const result = payload.candidates?.[0]?.content?.parts?.find(part => !part.thought && part.inlineData)?.inlineData;
  if (!result || !["image/png","image/jpeg","image/webp"].includes(result.mimeType) || result.data.length > 24_000_000) {
    throw new Error("Missing image result.");
  }
  const generated = await sharp(Buffer.from(result.data, "base64"), options).resize(edge, edge, { fit: "fill" }).png().toBuffer();
  const patch = await sharp(generated).extract({ left, top, width: size, height: size }).png().toBuffer();
  return sharp(original).composite([{ input: patch, left, top }]).png().toBuffer();
}

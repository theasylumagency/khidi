import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ReviewAdjustment, ReviewImageModel, ReviewPhotoMode, ReviewPlacement } from "@khidi/db";
import { AppError } from "@khidi/shared";

const edge = 1024;
const options = { limitInputPixels: 64_000_000, failOn: "error" } as const;
export type DetailMode = "INSET" | "MOUNT";
export type RenderModel = ReviewImageModel;
export type EditRequest = {
  mode: ReviewPhotoMode; model: RenderModel; base: Uint8Array; detail?: Uint8Array; text?: string;
  placement?: ReviewPlacement; settings?: ReviewAdjustment; actor?: string;
};

/** Modes whose result keeps every pixel outside the reviewer's square: only that square comes from the model. */
export const boxedModes: readonly ReviewPhotoMode[] = ["INSET", "MOUNT", "CLEAN"];
/** Which methods may produce each mode. Product pixels are never generated for a mode that offers only "local". */
export function modelsFor(mode: ReviewPhotoMode): RenderModel[] {
  if (mode === "ADJUST" || mode === "INSET") return ["local"];
  const ai: RenderModel[] = ["gpt-image-2.6-sunburst", "gpt-image-2.6-flare", "gemini-3-pro-image", "gemini-3.1-flash-image"];
  return mode === "MOUNT" ? ["local", ...ai] : ai;
}
export function providerConfigured(model: RenderModel) {
  if (model === "local") return true;
  return Boolean(model.startsWith("gpt-") ? process.env.REVIEW_OPENAI_API_KEY : process.env.REVIEW_GEMINI_API_KEY);
}

function square(bytes: Uint8Array) {
  return sharp(bytes, options).rotate().toColourspace("srgb").flatten({ background: "white" })
    .resize(edge, edge, { fit: "contain", background: "white" });
}
function box(p: ReviewPlacement) {
  const size = Math.round(edge * p.size / 100);
  return { size, left: Math.round((edge - size) * p.x / 100), top: Math.round((edge - size) * p.y / 100) };
}

export async function suggestReviewPlacement(base: Uint8Array, mode: DetailMode | "CLEAN"): Promise<ReviewPlacement> {
  if (mode === "CLEAN") return { x: 50, y: 50, size: 40 };
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

/** Quarter turns, optional trimming of plain borders and automatic tone, then the square catalog canvas. */
export async function adjustReviewPhoto(base: Uint8Array, s: ReviewAdjustment) {
  let image = await sharp(base, options).rotate().toColourspace("srgb").flatten({ background: "white" }).png().toBuffer();
  if (s.rotate) image = await sharp(image).rotate(s.rotate).png().toBuffer();
  if (s.trim) image = await sharp(image).trim({ threshold: 18 }).png().toBuffer().catch(() => image);
  if (s.tone) image = await sharp(image).normalise({ lower: 1, upper: 99 }).png().toBuffer();
  return square(image).png().toBuffer();
}

const keepProduct = "Keep the product exactly as photographed: identical geometry, proportions, part count, colors, "
  + "labels and camera angle. Do not add, remove or redesign any part of it. Add no lettering, logos, watermarks or people.";
function instructions(r: EditRequest, area: string) {
  const quoted = JSON.stringify(r.text ?? "");
  switch (r.mode) {
    case "MOUNT": return ["Produce one square photographic catalog mockup. Input 1 is the original machine, input 2 is the exact accessory.",
      "Mount that accessory only within " + area + ". Preserve the exact accessory geometry, count, color and labels.",
      "Preserve the surrounding machine, camera and background. Do not invent mounting hardware.",
      "The following quoted text only identifies the part:", quoted].join(" ");
    case "CLEAN": return ["Edit only within " + area + ". Remove only what the following quoted note describes and rebuild the",
      "background there so it continues the surrounding surface naturally:", quoted + ".", keepProduct].join(" ");
    case "BACKGROUND": return ["Replace only the background of this product photo with a seamless pure white studio background",
      "and a soft, natural contact shadow under the product.", keepProduct].join(" ");
    case "SCENE": return ["Create one realistic catalog photo that shows this exact product in use in the following setting,",
      "with the product fully visible as the main subject:", quoted + ".", keepProduct].join(" ");
    default: throw new AppError("VALIDATION_ERROR", "Mode has no provider edit.");
  }
}

async function decode(base64: string | undefined, mime = "image/png") {
  if (!base64 || base64.length > 24_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(mime)) {
    throw new Error("Missing image result.");
  }
  return sharp(Buffer.from(base64, "base64"), options).resize(edge, edge, { fit: "fill" }).png().toBuffer();
}

async function gemini(model: RenderModel, prompt: string, images: Buffer[]) {
  const part = (image: Buffer) => ({ inlineData: { mimeType: "image/png", data: image.toString("base64") } });
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.REVIEW_GEMINI_API_KEY! },
    signal: AbortSignal.timeout(100_000),
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, ...images.map(part)] }],
      generationConfig: { responseModalities: ["IMAGE"], candidateCount: 1, maxOutputTokens: 4096,
        imageConfig: { aspectRatio: "1:1", imageSize: "1K" } } })
  });
  if (!response.ok) throw new Error("Review image provider rejected the edit.");
  const payload = await response.json() as { candidates?: { content?: { parts?: {
    thought?: boolean; inlineData?: { mimeType: string; data: string }
  }[] } }[] };
  const result = payload.candidates?.[0]?.content?.parts?.find(p => !p.thought && p.inlineData)?.inlineData;
  return decode(result?.data, result?.mimeType);
}

async function openai(model: RenderModel, prompt: string, images: Buffer[], markup: Buffer | undefined, actor?: string) {
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("size", "1024x1024");
  form.set("quality", model === "gpt-image-2.6-sunburst" ? "high" : "medium");
  form.set("output_format", "png");
  if (actor) form.set("safety_identifier", createHash("sha256").update("khidi-review:" + actor).digest("hex").slice(0, 64));
  images.forEach((image, i) => form.append("image[]", new Blob([new Uint8Array(image)], { type: "image/png" }), `input-${i + 1}.png`));
  if (markup) form.set("markup", new Blob([new Uint8Array(markup)], { type: "image/png" }), "markup.png");
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST", headers: { Authorization: "Bearer " + process.env.REVIEW_OPENAI_API_KEY! },
    signal: AbortSignal.timeout(170_000), body: form
  });
  if (!response.ok) throw new Error("Review image provider rejected the edit.");
  const payload = await response.json() as { data?: { b64_json?: string }[] };
  return decode(payload.data?.[0]?.b64_json);
}

/** A transparent overlay with only the reviewer's square drawn on it (OpenAI markup-guided editing). */
function markupFor(b: ReturnType<typeof box>) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}"><rect x="${b.left + 3}" y="${b.top + 3}" `
    + `width="${Math.max(1, b.size - 6)}" height="${Math.max(1, b.size - 6)}" fill="none" stroke="#ff0000" stroke-width="6"/></svg>`;
  return sharp({ create: { width: edge, height: edge, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

export async function renderReviewEdit(r: EditRequest): Promise<Buffer> {
  if (!modelsFor(r.mode).includes(r.model)) throw new AppError("VALIDATION_ERROR", "Method is not available for this edit.");
  if (r.mode === "ADJUST") {
    if (!r.settings) throw new AppError("VALIDATION_ERROR", "Adjustment settings are required.");
    return adjustReviewPhoto(r.base, r.settings);
  }
  const boxed = boxedModes.includes(r.mode);
  if (boxed && !r.placement || (r.mode === "INSET" || r.mode === "MOUNT") && !r.detail) {
    throw new AppError("VALIDATION_ERROR", "Edit area or detail photo missing.");
  }
  if (!providerConfigured(r.model)) throw new AppError("VALIDATION_ERROR", "Review image provider is not configured.");
  const original = await square(r.base).png().toBuffer();
  const b = boxed ? box(r.placement!) : undefined;
  let source: Buffer | undefined, guide = original;
  if (r.detail && b) {
    source = await sharp(r.detail, options).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const tile = sharp(source);
    if (r.mode === "INSET") tile.flatten({ background: "white" });
    const thumbnail = await tile.resize(b.size, b.size, {
      fit: "contain", background: r.mode === "INSET" ? "white" : "#00000000"
    }).png().toBuffer();
    guide = await sharp(original).composite([{ input: thumbnail, left: b.left, top: b.top }]).png().toBuffer();
    if (r.model === "local") return guide;
  }
  const markup = b ? await markupFor(b) : undefined;
  let generated: Buffer;
  if (r.model.startsWith("gpt-")) {
    const area = "the square outlined in red on the markup image (" + JSON.stringify(b) + " pixels on 1024 x 1024)";
    generated = await openai(r.model, instructions(r, area), source ? [original, source] : [original], markup, r.actor);
  } else {
    const marked = b && !source ? await sharp(original).composite([{ input: markup! }]).png().toBuffer() : guide;
    const area = "the indicated square (" + JSON.stringify(b) + " pixels on 1024 x 1024; the last input shows it)";
    generated = await gemini(r.model, instructions(r, area), [original, ...(source ? [source] : []), ...(b ? [marked] : [])]);
  }
  if (!b) return generated;
  // Only the reviewer's square is taken from the model; every other pixel stays the photographed original.
  const patch = await sharp(generated).extract({ left: b.left, top: b.top, width: b.size, height: b.size }).png().toBuffer();
  return sharp(original).composite([{ input: patch, left: b.left, top: b.top }]).png().toBuffer();
}

/** Earlier signature, kept for the detail workflow. */
export function renderReviewComposition(base: Uint8Array, detail: Uint8Array, description: string,
  mode: DetailMode, placement: ReviewPlacement, model: RenderModel) {
  return renderReviewEdit({ mode, model, base, detail, text: description, placement });
}

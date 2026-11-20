import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { modelsFor, providerConfigured, renderReviewComposition, renderReviewEdit, suggestReviewPlacement } from "./review-composition.ts";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const image = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
const p = { x: 100, y: 100, size: 25 };
async function rgb(bytes: Buffer, x: number, y: number) {
  return [...await sharp(bytes).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
}

it("places an actual accessory at the reviewer's chosen scale, preserving aspect ratio and the base", async () => {
  const base = await image(128,128,"#646464");
  const part = await image(100,50,"red");
  const result = await renderReviewComposition(base, part, "ფრეზი", "INSET", p, "local");
  expect(await rgb(result,767,900)).toEqual([100,100,100]);
  expect(await rgb(result,768,800)).toEqual([255,255,255]);
  expect(await rgb(result,768,900)).toEqual([255,0,0]);
  expect(await rgb(result,1023,1023)).toEqual([255,255,255]);
});

it("suggests an empty inset corner and keeps generated pixels strictly within the edited square", async () => {
  const dark = await image(24,24,"black");
  const base = await sharp(await image(32,32,"white")).composite([{ input: dark, left: 8, top: 8 }]).png().toBuffer();
  const hint = await suggestReviewPlacement(base,"INSET");
  expect(hint.x < 50 || hint.y < 50).toBe(true);
  const blue = await image(64,64,"blue");
  vi.stubEnv("REVIEW_GEMINI_API_KEY","test-only");
  const mock = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [
    { inlineData: { mimeType: "image/png", data: blue.toString("base64") } }
  ] } }] }));
  vi.stubGlobal("fetch",mock);
  const result = await renderReviewComposition(base, dark, "ფრეზი", "MOUNT", p, "gemini-3-pro-image");
  expect(mock).toHaveBeenCalledTimes(1);
  expect(await rgb(result,767,880)).toEqual([0,0,0]);
  expect(await rgb(result,768,880)).toEqual([0,0,255]);
  expect(await rgb(result,0,0)).toEqual([255,255,255]);
});

it("uses the photographed machine for the initial mounting position and makes no provider call without a key", async () => {
  const base = await sharp(await image(32,32,"white")).composite([
    { input: await image(12,12,"black"), left: 2, top: 2 }
  ]).png().toBuffer();
  const suggestion = await suggestReviewPlacement(base,"MOUNT");
  expect(suggestion.x).toBeLessThan(50);
  expect(suggestion.y).toBeLessThan(50);
  vi.stubEnv("REVIEW_GEMINI_API_KEY","");
  const provider = vi.fn();
  vi.stubGlobal("fetch",provider);
  await expect(renderReviewComposition(base, base, "ფრეზი", "MOUNT", suggestion, "gemini-3.1-flash-image"))
    .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(provider).not.toHaveBeenCalled();
});

it("adjusts a real photo deterministically: quarter turn, trimmed plain border, square white canvas, no provider call", async () => {
  const provider = vi.fn();
  vi.stubGlobal("fetch", provider);
  const tall = await sharp(await image(200, 100, "white")).composite([{ input: await image(100, 50, "red"), left: 50, top: 25 }]).png().toBuffer();
  const result = await renderReviewEdit({ mode: "ADJUST", model: "local", base: tall, settings: { rotate: 90, tone: false, trim: true } });
  const meta = await sharp(result).metadata();
  expect([meta.width, meta.height]).toEqual([1024, 1024]);
  // After trimming the 100 x 50 red block and turning it, it fills the canvas height: a 512-wide band in the middle.
  expect(await rgb(result, 512, 512)).toEqual([255, 0, 0]);
  expect(await rgb(result, 100, 512)).toEqual([255, 255, 255]);
  expect(provider).not.toHaveBeenCalled();
  await expect(renderReviewEdit({ mode: "ADJUST", model: "gpt-image-2.6-sunburst", base: tall,
    settings: { rotate: 0, tone: true, trim: false } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});

it("sends a clean-up to OpenAI with the photo and a red-square markup, and keeps every pixel outside the square", async () => {
  vi.stubEnv("REVIEW_OPENAI_API_KEY", "test-only");
  const green = await image(1024, 1024, "#00ff00");
  let form: FormData | undefined, target = "";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    target = url; form = init.body as FormData;
    return Response.json({ data: [{ b64_json: green.toString("base64") }] });
  }));
  const base = await image(64, 64, "#646464");
  const result = await renderReviewEdit({ mode: "CLEAN", model: "gpt-image-2.6-sunburst", base, text: "მუყაოს ყუთი",
    placement: { x: 0, y: 0, size: 25 }, actor: "user-1" });
  expect(target).toBe("https://api.openai.com/v1/images/edits");
  expect(form!.get("model")).toBe("gpt-image-2.6-sunburst");
  expect(form!.getAll("image[]")).toHaveLength(1);
  expect(String(form!.get("prompt"))).toContain("მუყაოს ყუთი");
  expect(form!.get("safety_identifier")).not.toContain("user-1");
  const markup = Buffer.from(await (form!.get("markup") as Blob).arrayBuffer());
  expect((await sharp(markup).metadata()).hasAlpha).toBe(true);
  expect(await rgb(result, 100, 100)).toEqual([0, 255, 0]);
  expect(await rgb(result, 300, 300)).toEqual([100, 100, 100]);
});

it("replaces the whole background through Gemini and offers only configured AI methods for generated edits", async () => {
  vi.stubEnv("REVIEW_GEMINI_API_KEY", "test-only");
  vi.stubEnv("REVIEW_OPENAI_API_KEY", "");
  const blue = await image(512, 512, "blue");
  const call = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [
    { inlineData: { mimeType: "image/png", data: blue.toString("base64") } }] } }] }));
  vi.stubGlobal("fetch", call);
  const result = await renderReviewEdit({ mode: "BACKGROUND", model: "gemini-3-pro-image", base: await image(32, 32, "gray") });
  expect(call).toHaveBeenCalledTimes(1);
  expect(await rgb(result, 5, 5)).toEqual([0, 0, 255]);
  await expect(renderReviewEdit({ mode: "SCENE", model: "gpt-image-2.6-flare", base: blue, text: "ვენახში" }))
    .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(modelsFor("BACKGROUND")).not.toContain("local");
  expect(modelsFor("INSET")).toEqual(["local"]);
  expect(providerConfigured("gemini-3-pro-image")).toBe(true);
  expect(providerConfigured("gpt-image-2.6-sunburst")).toBe(false);
});

it("applies a free instruction to the whole photo, or only inside the reviewer's square when she limited it", async () => {
  vi.stubEnv("REVIEW_OPENAI_API_KEY", "test-only");
  const green = await image(1024, 1024, "#00ff00");
  const forms: FormData[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    forms.push(init.body as FormData);
    return Response.json({ data: [{ b64_json: green.toString("base64") }] });
  }));
  const base = await image(64, 64, "#646464");
  const whole = await renderReviewEdit({ mode: "INSTRUCT", model: "gpt-image-2.6-flare", base, text: "ძრავს ჟანგი მოაშორე" });
  expect(await rgb(whole, 900, 900)).toEqual([0, 255, 0]);
  expect(forms[0]!.get("markup")).toBeNull();
  expect(String(forms[0]!.get("prompt"))).toContain("ძრავს ჟანგი მოაშორე");
  const limited = await renderReviewEdit({ mode: "INSTRUCT", model: "gpt-image-2.6-flare", base, text: "ძრავს ჟანგი მოაშორე",
    placement: { x: 0, y: 0, size: 25 } });
  expect(forms[1]!.get("markup")).not.toBeNull();
  expect(await rgb(limited, 100, 100)).toEqual([0, 255, 0]);
  expect(await rgb(limited, 900, 900)).toEqual([100, 100, 100]);
  await expect(renderReviewEdit({ mode: "INSTRUCT", model: "gpt-image-2.6-flare", base, text: " " }))
    .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(forms).toHaveLength(2);
});

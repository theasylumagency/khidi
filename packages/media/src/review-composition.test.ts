import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { renderReviewComposition, suggestReviewPlacement } from "./review-composition.ts";

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

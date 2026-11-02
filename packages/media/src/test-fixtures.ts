import sharp from "sharp";
/** Deterministic textured raster: sharp edges, no clipped highlights/shadows. */
export async function fixturePhoto(width = 1920, height = 1280, seed = 0) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = ((x + seed * 13) >> 4 ^ (y + seed * 7) >> 4) & 1 ? 185 : 65;
    const p = (y * width + x) * 3; data[p] = value; data[p + 1] = value + 10; data[p + 2] = value + 20;
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

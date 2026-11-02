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
/** Real EXIF TIFF GPS IFD (41° N, 44° E) and orientation=6, injected into a JPEG. */
export async function gpsFixturePhoto() {
  const jpeg = await fixturePhoto(), tiff = Buffer.alloc(140);
  tiff.write("II"); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(2, 8);
  function entry(at: number, tag: number, type: number, count: number, value: number) { tiff.writeUInt16LE(tag, at); tiff.writeUInt16LE(type, at + 2); tiff.writeUInt32LE(count, at + 4); tiff.writeUInt32LE(value, at + 8); }
  entry(10, 0x0112, 3, 1, 6); entry(22, 0x8825, 4, 1, 38);
  tiff.writeUInt16LE(4, 38); entry(40, 1, 2, 2, 78); entry(52, 2, 5, 3, 92); entry(64, 3, 2, 2, 69); entry(76, 4, 5, 3, 116);
  for (const [offset, degrees] of [[92, 41], [116, 44]]) for (let part = 0; part < 3; part++) { tiff.writeUInt32LE(part === 0 ? degrees! : 0, offset! + part * 8); tiff.writeUInt32LE(1, offset! + part * 8 + 4); }
  const exif = Buffer.concat([Buffer.from("Exif\0\0"), tiff]), header = Buffer.from([0xff, 0xe1, 0, 0]); header.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, exif, jpeg.subarray(2)]);
}

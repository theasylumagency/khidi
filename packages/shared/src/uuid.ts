// Browser-safe entry point: no imports from the server's crypto/secret helpers.
let lastTimestamp = -1;
let sequence = 0;
export function createUuidV7(nowMs: number = Date.now()): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs >= 2 ** 48) throw new RangeError("Invalid UUIDv7 timestamp.");
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let timestamp = Math.max(nowMs, lastTimestamp);
  if (timestamp === lastTimestamp) {
    sequence++;
    if (sequence > 0xfff) { timestamp++; sequence = 0; }
  } else sequence = ((bytes[6]! << 8) | bytes[7]!) & 0xfff;
  lastTimestamp = timestamp;
  let remaining = BigInt(timestamp);
  for (let index = 5; index >= 0; index--) { bytes[index] = Number(remaining & 0xffn); remaining >>= 8n; }
  bytes[6] = 0x70 | (sequence >> 8);
  bytes[7] = sequence & 0xff;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

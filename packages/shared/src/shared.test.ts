import { describe, expect, it } from "vitest";
import {
  AppError,
  createUuidV7,
  decryptSecretAes256Gcm,
  DEFAULT_DEV_TOTP_KEY_HEX,
  encryptSecretAes256Gcm,
  formatTbilisiDateTime,
  formatTetri,
  parseLariToTetri,
  tetri
} from "./index.ts";

describe("@khidi/shared", () => {
  it("encrypts and decrypts secrets using AES-256-GCM", () => {
    const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const cipher = encryptSecretAes256Gcm("JBSWY3DPEHPK3PXP", key);
    expect(cipher.startsWith("v1:")).toBe(true);
    expect(decryptSecretAes256Gcm(cipher, key)).toBe("JBSWY3DPEHPK3PXP");
    expect(() => decryptSecretAes256Gcm("JBSWY3DPEHPK3PXP", key)).toThrow(AppError);
  });

  it("fails fast in NODE_ENV=production if HUB_TOTP_ENCRYPTION_KEY is missing or uses the default dev key", () => {
    expect(() =>
      encryptSecretAes256Gcm("JBSWY3DPEHPK3PXP", undefined, {
        NODE_ENV: "production"
      })
    ).toThrow(/CRITICAL: HUB_TOTP_ENCRYPTION_KEY/);

    expect(() =>
      encryptSecretAes256Gcm("JBSWY3DPEHPK3PXP", undefined, {
        NODE_ENV: "production",
        HUB_TOTP_ENCRYPTION_KEY: DEFAULT_DEV_TOTP_KEY_HEX
      })
    ).toThrow(/CRITICAL: HUB_TOTP_ENCRYPTION_KEY/);

    const prodKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    const encrypted = encryptSecretAes256Gcm("JBSWY3DPEHPK3PXP", undefined, {
      NODE_ENV: "production",
      HUB_TOTP_ENCRYPTION_KEY: prodKey
    });
    expect(
      decryptSecretAes256Gcm(encrypted, undefined, {
        NODE_ENV: "production",
        HUB_TOTP_ENCRYPTION_KEY: prodKey
      })
    ).toBe("JBSWY3DPEHPK3PXP");
  });
  it("generates monotonic UUIDv7 identifiers", () => {
    const id1 = createUuidV7(1762000000000);
    const id2 = createUuidV7(1762000000000);
    const id3 = createUuidV7(1762000000001);

    expect(id1 < id2).toBe(true);
    expect(id2 < id3).toBe(true);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("keeps offline UUIDs ordered through sequence overflow and a backward device clock", () => {
    const timestamp = Date.now() + 1000;
    let previous = createUuidV7(timestamp);
    for (let i = 0; i < 5000; i++) {
      const current = createUuidV7(timestamp);
      expect(current > previous).toBe(true);
      previous = current;
    }
    expect(createUuidV7(timestamp - 1000) > previous).toBe(true);
  });

  it("enforces integer minor units (tetri) and rejects floats (§3.4)", () => {
    expect(tetri(185000)).toEqual({ amountMinor: 185000, currency: "GEL" });
    expect(() => tetri(18.5)).toThrow(AppError);
    expect(parseLariToTetri("1850.50")).toBe(185050);
    expect(formatTetri(185050)).toBe("1850.50 ₾");
  });

  it("formats UTC timestamps in Asia/Tbilisi timezone (§3.4)", () => {
    const utcDate = new Date("2026-11-01T10:00:00Z");
    const formatted = formatTbilisiDateTime(utcDate, "en");
    // Asia/Tbilisi is UTC+4 -> 14:00:00
    expect(formatted).toContain("14:00:00");
  });
});

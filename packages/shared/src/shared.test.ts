import { describe, expect, it } from "vitest";
import {
  AppError,
  createUuidV7,
  formatTbilisiDateTime,
  formatTetri,
  parseLariToTetri,
  tetri
} from "./index.ts";

describe("@agrotrade/shared", () => {
  it("generates monotonic UUIDv7 identifiers", () => {
    const id1 = createUuidV7(1762000000000);
    const id2 = createUuidV7(1762000000000);
    const id3 = createUuidV7(1762000000001);

    expect(id1 < id2).toBe(true);
    expect(id2 < id3).toBe(true);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
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

import { describe, expect, it } from "vitest";
import { formatStaffName } from "./index.ts";
describe("neutral staff names in scanning views", () => {
  it("removes legacy role/affiliation annotations while preserving the person's name", () => {
    expect(formatStaffName("ლიკა მაისურაძე (private affiliation)")).toBe("ლიკა მაისურაძე");
    expect(formatStaffName("ნინო კაპანაძე")).toBe("ნინო კაპანაძე");
  });
});

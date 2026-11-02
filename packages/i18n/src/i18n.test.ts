import { describe, expect, it } from "vitest";
import { formatStaffName, getNavigationForRole } from "./index.ts";
describe("neutral staff names in scanning views", () => {
  it("removes legacy role/affiliation annotations while preserving the person's name", () => {
    expect(formatStaffName("ლიკა მაისურაძე (private affiliation)")).toBe("ლიკა მაისურაძე");
    expect(formatStaffName("ნინო კაპანაძე")).toBe("ნინო კაპანაძე");
  });
  it("routes warehouse task navigation to the assigned-work list", () => {
    expect(getNavigationForRole("WAREHOUSE").find((item) => item.key === "tasks")?.href).toBe("/warehouse/tasks");
    expect(getNavigationForRole("ADMIN").find((item) => item.key === "tasks")?.href).toBe("/tasks");
  });
});

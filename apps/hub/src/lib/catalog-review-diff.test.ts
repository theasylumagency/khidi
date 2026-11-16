import { describe, expect, it } from "vitest";
import { compareReviewText } from "./catalog-review-diff.ts";

describe("catalog text comparison", () => {
  it.each([
    ["", "ახალი ტექსტი"], ["ძველი ტექსტი", ""], ["", ""],
    ["სიმძლავრე 7 ცხ.ძ.\nწონა 112 კგ", "სიმძლავრე 9 ცხ.ძ."],
    ["A A B A", "A B A A"], ["ძრავა: MQ170GS\r\n", "ძრავა: MQ170GS\n"],
    ["<script>alert('x')</script>", "<img src=x onerror=alert(1)>"],
    ["გამარჯობა 🛠️ é", "გამარჯობა 👋 é"]
  ])("preserves every character of both versions (%s)", (before, after) => {
    const { changes } = compareReviewText(before, after);
    expect(changes.filter((part) => part.kind !== "added").map((part) => part.text).join("")).toBe(before);
    expect(changes.filter((part) => part.kind !== "removed").map((part) => part.text).join("")).toBe(after);
  });
  it("exposes a changed number and a dropped specification without treating it as a correction", () => {
    const { changes } = compareReviewText("ძალა 7 ცხ.ძ.\nწონა 112 კგ", "ძალა 9 ცხ.ძ.");
    expect(changes).toContainEqual({ kind: "removed", text: "7" });
    expect(changes).toContainEqual({ kind: "added", text: "9" });
    expect(changes).toContainEqual({ kind: "removed", text: "\nწონა 112 კგ" });
  });
  it("falls back to intact blocks for oversized input", () => {
    const before = "ძველი ტექსტი ".repeat(2000), after = "ახალი ტექსტი ".repeat(2000);
    expect(compareReviewText(before, after)).toEqual({ coarse: true, changes: [
      { kind: "removed", text: before }, { kind: "added", text: after }
    ] });
  });
});

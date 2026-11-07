import { expect, it } from "vitest";
import { formatPrice, parsePriceInput } from "./format.ts";
it("accepts point/comma minor units and rejects grouping, excess precision and nonpositive amounts", () => {
  expect(parsePriceInput("1234.50")).toBe(123450);
  expect(parsePriceInput("1234,50")).toBe(123450);
  for (const value of ["1 234.50", "1,234.50", "1.234,50", "1.234", "0", "-1", "1e2", "", "21474836.48"]) expect(parsePriceInput(value)).toBeNull();
  expect(formatPrice(123450)).toBe("1 234,50 ₾");
});

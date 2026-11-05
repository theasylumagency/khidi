import { afterEach, expect, it, vi } from "vitest";
import { readQuickSignInPreference, signQuickSignInPreference } from "./quick-sign-in-cookie.ts";

const id = "019a11a1-1111-7111-8111-111111111111";
afterEach(() => vi.useRealTimers());

it("authenticates the browser preference, including its account hint and name consent", () => {
  const value = signQuickSignInPreference("key", id);
  expect(readQuickSignInPreference(value)).toEqual({ mode: "key", id });
  expect(readQuickSignInPreference(value.replace(/^key/, "named"))).toBeNull();
  expect(readQuickSignInPreference(value.replace(id, "019a11a1-1111-7111-8111-111111111112"))).toBeNull();
  expect(readQuickSignInPreference("not-a-preference")).toBeNull();
});

it("expires signed preferences independently of the browser", () => {
  vi.useFakeTimers();
  const value = signQuickSignInPreference("named", id);
  expect(readQuickSignInPreference(value)).toEqual({ mode: "named", id });
  vi.setSystemTime(Date.now() + 180 * 24 * 60 * 60 * 1000);
  expect(readQuickSignInPreference(value)).toBeNull();
});

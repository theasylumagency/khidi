import { beforeEach, expect, it, vi } from "vitest";

const verifySessionToken = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3100" }),
  cookies: async () => ({ get: () => ({ value: "khidi_sess_test" }) })
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(path); },
  notFound: () => { throw new Error("not found"); }
}));
vi.mock("@khidi/auth", () => ({ verifySessionToken }));
vi.mock("@khidi/db", () => ({ getDb: () => ({}) }));

import { getCurrentPrincipal, requirePageAuth } from "./session.ts";

beforeEach(() => verifySessionToken.mockResolvedValue({ role: "CATALOG_REVIEWER" }));

it("fails closed for ordinary Hub APIs and pages and permits explicitly opted-in review pages", async () => {
  expect(await getCurrentPrincipal()).toBeNull();
  await expect(requirePageAuth()).rejects.toThrow("/review");
  await expect(requirePageAuth({ allowedRoles: ["ADMIN"] })).rejects.toThrow("/review");
  expect(await requirePageAuth({ allowedRoles: ["CATALOG_REVIEWER"] })).toMatchObject({ role: "CATALOG_REVIEWER" });
  expect(await getCurrentPrincipal({ allowCatalogReviewer: true })).toMatchObject({ role: "CATALOG_REVIEWER" });
});

it("preserves existing roles in ordinary Hub requests", async () => {
  verifySessionToken.mockResolvedValue({ role: "OPERATOR" });
  expect(await getCurrentPrincipal()).toMatchObject({ role: "OPERATOR" });
  await expect(requirePageAuth({ allowedRoles: ["CATALOG_REVIEWER"] })).rejects.toThrow("/?forbidden=1");
});

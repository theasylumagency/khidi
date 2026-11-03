import { afterEach, expect, it, vi } from "vitest";
import { assertSeedDatabaseSafety } from "../../db/src/seed-database-safety.ts";
import { runSeed } from "../../db/src/seed.ts";
import { runProductsSeed } from "./seed-products.ts";
import { assertBootstrapConsole } from "../../../ops/bootstrap-admin.ts";
const clients = vi.hoisted(() => ({ getDb: vi.fn(), closeAppPool: vi.fn() }));
vi.mock("../../db/src/client.ts", () => clients);
const safe = { NODE_ENV: "development", DATABASE_URL: "postgres://app:unit-secret@localhost/khidi_dev", DATABASE_MIGRATOR_URL: "postgres://migrator:unit-secret@localhost/khidi_dev" };
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it.each([
  ["production even with a dev name", { ...safe, NODE_ENV: "production" }],
  ["missing app URL", { ...safe, DATABASE_URL: undefined }],
  ["missing migrator URL", { ...safe, DATABASE_MIGRATOR_URL: undefined }],
  ["unsafe app", { ...safe, DATABASE_URL: "postgres://localhost/agrotrade_hub" }],
  ["unsafe migrator", { ...safe, DATABASE_MIGRATOR_URL: "postgres://localhost/agrotrade_hub" }],
  ["malformed URL", { ...safe, DATABASE_URL: "invalid-unit-secret" }],
  ["malformed encoding", { ...safe, DATABASE_URL: "postgres://localhost/khidi%ZZ_dev" }],
  ["database override", { ...safe, DATABASE_URL: "postgres://localhost/khidi_dev?dbname=agrotrade_hub" }],
  ["overlong name", { ...safe, DATABASE_URL: `postgres://localhost/${"a".repeat(63)}_dev` }],
  ["escape hatch", { ...safe, DATABASE_URL: "postgres://localhost/agrotrade_hub", FORCE_SEED: "true" }]
] satisfies [string, NodeJS.ProcessEnv][])("rejects %s before either seed can create a DB client", async (_name, env) => {
  for (const key of ["NODE_ENV", "DATABASE_URL", "DATABASE_MIGRATOR_URL"] as const) vi.stubEnv(key, env[key]);
  expect(() => assertSeedDatabaseSafety(env)).toThrow(/^SAFETY:/);
  await expect(runSeed()).rejects.toThrow(/^SAFETY:/);
  await expect(runProductsSeed()).rejects.toThrow(/^SAFETY:/);
  expect(clients.getDb).not.toHaveBeenCalled();
});
it.each(["khidi_dev", "khidi_test", "khidi%5Fdev"])("allows explicit local seed database %s", (name) => {
  expect(() => assertSeedDatabaseSafety({ ...safe, DATABASE_URL: `postgres://localhost/${name}`, DATABASE_MIGRATOR_URL: `postgresql://localhost/${name}` })).not.toThrow();
});
it("never exposes connection credentials in guard errors", () => {
  try { assertSeedDatabaseSafety({ ...safe, DATABASE_URL: "postgres://app:unit-secret@[bad/khidi_dev" }); }
  catch (error) { expect(String(error)).toContain("SAFETY:"); expect(String(error)).not.toContain("unit-secret"); return; }
  throw new Error("Expected guard rejection.");
});
it("bootstrap requires production, a terminal and no command-line credential arguments", () => {
  expect(() => assertBootstrapConsole({}, [], true, true)).toThrow(/SAFETY/);
  expect(() => assertBootstrapConsole({ NODE_ENV: "production" }, ["--password=secret"], true, true)).toThrow(/SAFETY/);
  expect(() => assertBootstrapConsole({ NODE_ENV: "production" }, [], false, true)).toThrow(/SAFETY/);
  expect(() => assertBootstrapConsole({ NODE_ENV: "production" }, [], true, false)).toThrow(/SAFETY/);
  expect(() => assertBootstrapConsole({ NODE_ENV: "production" }, [], true, true)).not.toThrow();
});

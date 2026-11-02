import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTestDatabaseSafety } from "./test-database-safety.ts";
import { setup } from "../../../vitest.global-setup.ts";

const db = vi.hoisted(() => ({ runMigrations: vi.fn(), runSeed: vi.fn(), closeAppPool: vi.fn(), runProductsSeed: vi.fn() }));
vi.mock("./index.ts", () => db);
vi.mock("../../products/src/seed-products.ts", () => ({ runProductsSeed: db.runProductsSeed }));

const safe = { NODE_ENV: "test", DATABASE_URL: "postgres://app:unit-secret@localhost/khidi_test",
  DATABASE_MIGRATOR_URL: "postgresql://migrator:unit-secret@localhost/khidi_test" };

describe("test database safety (no PostgreSQL connection)", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => vi.clearAllMocks());

  const invalid: Array<[string, NodeJS.ProcessEnv, RegExp]> = [
    ["missing NODE_ENV", { ...safe, NODE_ENV: undefined }, /SAFETY:.*NODE_ENV/],
    ["production NODE_ENV", { ...safe, NODE_ENV: "production" }, /SAFETY:.*NODE_ENV/],
    ["missing DATABASE_URL", { ...safe, DATABASE_URL: undefined }, /SAFETY: DATABASE_URL is required/],
    ["missing DATABASE_MIGRATOR_URL", { ...safe, DATABASE_MIGRATOR_URL: undefined }, /SAFETY: DATABASE_MIGRATOR_URL is required/],
    ["blank DATABASE_URL", { ...safe, DATABASE_URL: "   " }, /SAFETY: DATABASE_URL is required/],
    ["two non-test databases", { ...safe, DATABASE_URL: "postgres://localhost/agrotrade_hub", DATABASE_MIGRATOR_URL: "postgres://localhost/agrotrade_hub" }, /SAFETY:.*_test/],
    ["unsafe app with safe migrator", { ...safe, DATABASE_URL: "postgres://localhost/agrotrade_hub" }, /SAFETY: DATABASE_URL.*_test/],
    ["safe app with unsafe migrator", { ...safe, DATABASE_MIGRATOR_URL: "postgres://localhost/agrotrade_hub" }, /SAFETY: DATABASE_MIGRATOR_URL.*_test/],
    ["test only in the query", { ...safe, DATABASE_URL: "postgres://localhost/agrotrade_hub?application_name=khidi_test" }, /SAFETY:.*_test/],
    ["test is not the suffix", { ...safe, DATABASE_URL: "postgres://localhost/khidi_test_backup" }, /SAFETY:.*_test/],
    ["malformed app URL", { ...safe, DATABASE_URL: "not-a-url-unit-secret" }, /SAFETY: DATABASE_URL.*valid PostgreSQL URL/],
    ["malformed migrator URL", { ...safe, DATABASE_MIGRATOR_URL: "postgres://[invalid/khidi_test" }, /SAFETY: DATABASE_MIGRATOR_URL.*valid PostgreSQL URL/],
    ["wrong protocol", { ...safe, DATABASE_URL: "https://localhost/khidi_test" }, /SAFETY:.*valid PostgreSQL URL/],
    ["no explicit database", { ...safe, DATABASE_URL: "postgres://localhost" }, /SAFETY:.*valid PostgreSQL URL/],
    ["malformed encoding", { ...safe, DATABASE_URL: "postgres://localhost/khidi%ZZ_test" }, /SAFETY:.*valid PostgreSQL URL/],
    ["malformed password encoding", { ...safe, DATABASE_URL: "postgres://app:unit-secret%ZZ@localhost/khidi_test" }, /SAFETY:.*valid PostgreSQL URL/],
    ["encoded null byte", { ...safe, DATABASE_URL: "postgres://localhost/agrotrade_hub%00_test" }, /SAFETY:.*valid PostgreSQL URL/],
    ["overlong database name", { ...safe, DATABASE_URL: `postgres://localhost/${"a".repeat(63)}_test` }, /SAFETY:.*63 UTF-8 bytes/],
    ["overlong UTF-8 name", { ...safe, DATABASE_URL: `postgres://localhost/${"ა".repeat(21)}_test` }, /SAFETY:.*63 UTF-8 bytes/],
    ["database override", { ...safe, DATABASE_URL: "postgres://localhost/khidi_test?dbname=agrotrade_hub" }, /SAFETY:.*valid PostgreSQL URL/],
    ["connection override", { ...safe, DATABASE_URL: "postgres://localhost/khidi_test?connectionString=postgres%3A%2F%2Flocalhost%2Fagrotrade_hub" }, /SAFETY:.*valid PostgreSQL URL/],
    ["attempted escape hatch", { ...safe, DATABASE_URL: "postgres://localhost/agrotrade_hub", FORCE_TESTS_ON_PRODUCTION: "true" }, /SAFETY:.*_test/]
  ];

  it.each(invalid)("rejects %s before migrations or either seed can run", async (_name, env, message) => {
    expect(() => assertTestDatabaseSafety(env)).toThrow(message);
    for (const key of ["NODE_ENV", "DATABASE_URL", "DATABASE_MIGRATOR_URL"] as const) vi.stubEnv(key, env[key]);
    await expect(setup()).rejects.toThrow(message);
    for (const operation of Object.values(db)) expect(operation).not.toHaveBeenCalled();
  });

  it.each(["agrotrade_hub_test", "khidi_ci_test", "khidi%5Ftest", `${"a".repeat(58)}_test`])("accepts an explicit %s database for both roles", (name) => {
    expect(() => assertTestDatabaseSafety({ ...safe, DATABASE_URL: `postgres://localhost/${name}?sslmode=require`,
      DATABASE_MIGRATOR_URL: `postgresql://localhost/${name}` })).not.toThrow();
  });

  it("does not leak a URL or password into parse errors", () => {
    try { assertTestDatabaseSafety({ ...safe, DATABASE_URL: "postgres://app:unit-secret@[invalid/khidi_test" }); }
    catch (error) { expect(String(error)).toMatch(/^Error: SAFETY:/); expect(String(error)).not.toContain("unit-secret"); return; }
    throw new Error("Expected invalid URL rejection.");
  });

  it("runs migrations, foundation seed and product seed in order only after a valid guard", async () => {
    for (const key of ["NODE_ENV", "DATABASE_URL", "DATABASE_MIGRATOR_URL"] as const) vi.stubEnv(key, safe[key]);
    await setup();
    const order = [db.runMigrations, db.runSeed, db.runProductsSeed, db.closeAppPool];
    for (const operation of order) expect(operation).toHaveBeenCalledTimes(1);
    expect(order.map((operation) => operation.mock.invocationCallOrder[0])).toEqual(order.map((operation) => operation.mock.invocationCallOrder[0]).toSorted((a, b) => a! - b!));
  });
});

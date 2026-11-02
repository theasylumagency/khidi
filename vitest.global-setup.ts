import { assertTestDatabaseSafety } from "./packages/db/src/test-database-safety.ts";

/**
 * Global Vitest setup: ensures all migrations and foundation/product seeds
 * are applied once before any test file executes, regardless of test file execution order.
 */
export async function setup() {
  // Fail closed before importing database code, opening a connection or mutating data.
  assertTestDatabaseSafety();
  const { closeAppPool, runMigrations, runSeed } = await import("./packages/db/src/index.ts");
  const { runProductsSeed } = await import("./packages/products/src/seed-products.ts");
  try {
    await runMigrations();
    await runSeed();
    await runProductsSeed();
  } finally {
    await closeAppPool();
  }
}

import { closeAppPool, runMigrations, runSeed } from "./packages/db/src/index.ts";
import { runProductsSeed } from "./packages/products/src/seed-products.ts";

/**
 * Global Vitest setup: ensures all migrations and foundation/product seeds
 * are applied once before any test file executes, regardless of test file execution order.
 */
export async function setup() {
  await runMigrations();
  await runSeed();
  await runProductsSeed();
  await closeAppPool();
}

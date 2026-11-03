import { defineConfig } from "vitest/config";

// Only the pure guard/setup-with-mocks tests: never load integration global setup.
export default defineConfig({
  test: { include: ["packages/db/src/test-database-safety.test.ts", "packages/products/src/seed-safety.test.ts"], fileParallelism: false }
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
    globalSetup: ["./vitest.global-setup.ts"],
    fileParallelism: false,
    testTimeout: 15000
  }
});

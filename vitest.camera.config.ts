import { defineConfig } from "vitest/config";
// Browser-independent presentation/lifecycle tests; no database setup.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { include: ["apps/hub/src/lib/camera-shell.test.ts", "apps/hub/src/lib/photo-workflow.test.ts", "apps/hub/src/lib/service-worker.test.ts", "apps/hub/src/components/camera-surface.test.tsx"] }
});

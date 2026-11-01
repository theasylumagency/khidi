import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");
const require = createRequire(import.meta.url);

describe("Architecture Boundary Rules [C5]", () => {
  it("verifies that packages/products does not depend on pricing, inventory, fulfillment, or publishing", () => {
    const productsPkg = JSON.parse(
      readFileSync(join(repoRoot, "packages", "products", "package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };

    const deps = Object.keys(productsPkg.dependencies ?? {});
    expect(deps).not.toContain("@agrotrade/pricing");
    expect(deps).not.toContain("@agrotrade/inventory");
    expect(deps).not.toContain("@agrotrade/fulfillment");
    expect(deps).not.toContain("@agrotrade/publishing");
  });

  it("verifies that lower-layer packages do not depend on @agrotrade/publishing [C5]", () => {
    const lowerPackages = [
      "shared",
      "db",
      "domain",
      "auth",
      "entities",
      "products",
      "evidence",
      "media",
      "scanning",
      "ai",
      "pricing",
      "inventory"
    ];

    for (const pkgName of lowerPackages) {
      const pkgJson = JSON.parse(
        readFileSync(join(repoRoot, "packages", pkgName, "package.json"), "utf8")
      ) as { dependencies?: Record<string, string> };

      const deps = Object.keys(pkgJson.dependencies ?? {});
      expect(deps, `packages/${pkgName} must not depend on @agrotrade/publishing`).not.toContain(
        "@agrotrade/publishing"
      );
    }
  });

  it("loads .dependency-cruiser.cjs rules enforcing no-circular and forbidden imports [C5]", () => {
    const config = require(join(repoRoot, ".dependency-cruiser.cjs")) as {
      forbidden: Array<{ name: string; severity: string }>;
    };

    const ruleNames = config.forbidden.map((r) => r.name);
    expect(ruleNames).toContain("no-circular");
    expect(ruleNames).toContain("products-must-not-import-commerce-or-publishing");
    expect(ruleNames).toContain("lower-layers-must-not-import-publishing");
  });
});

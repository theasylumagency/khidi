import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");

function collectFilesRecursively(dir: string, predicate: (filePath: string) => boolean): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectFilesRecursively(fullPath, predicate));
    } else if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("Architecture, Security & Concealment Verification ([C5, C6, C12], CVE-2025-55182)", () => {
  it("enforces Next.js 16.x and React >= 19.2.1 to remediate CVE-2025-55182 (React2Shell)", () => {
    const hubPkg = JSON.parse(
      readFileSync(join(repoRoot, "apps", "hub", "package.json"), "utf8")
    ) as {
      name: string;
      dependencies: Record<string, string>;
    };

    expect(hubPkg.name).toBe("@khidi/hub");

    const nextVer = hubPkg.dependencies.next ?? "";
    const reactVer = hubPkg.dependencies.react ?? "";
    const reactDomVer = hubPkg.dependencies["react-dom"] ?? "";

    const [nextMajor = 0] = nextVer.replace(/^[^\d]*/, "").split(".").map(Number);
    const [reactMajor = 0, reactMinor = 0, reactPatch = 0] = reactVer
      .replace(/^[^\d]*/, "")
      .split(".")
      .map(Number);

    expect(nextMajor).toBeGreaterThanOrEqual(16);
    expect(reactMajor).toBe(19);
    const isReactPatched = reactMinor > 2 || (reactMinor === 2 && reactPatch >= 1);
    expect(isReactPatched).toBe(true);
    expect(reactDomVer).toBe(reactVer);
  });

  it("enforces acyclic DAG module boundaries for @khidi/publishing above catalog and commerce ([C5])", () => {
    const publishingPkg = JSON.parse(
      readFileSync(join(repoRoot, "packages", "publishing", "package.json"), "utf8")
    ) as { dependencies: Record<string, string> };

    const productsPkg = JSON.parse(
      readFileSync(join(repoRoot, "packages", "products", "package.json"), "utf8")
    ) as { dependencies: Record<string, string> };

    const pricingPkg = JSON.parse(
      readFileSync(join(repoRoot, "packages", "pricing", "package.json"), "utf8")
    ) as { dependencies: Record<string, string> };

    const inventoryPkg = JSON.parse(
      readFileSync(join(repoRoot, "packages", "inventory", "package.json"), "utf8")
    ) as { dependencies: Record<string, string> };

    expect(publishingPkg.dependencies["@khidi/products"]).toBeDefined();
    expect(publishingPkg.dependencies["@khidi/pricing"]).toBeDefined();
    expect(publishingPkg.dependencies["@khidi/inventory"]).toBeDefined();

    // Catalog and commerce packages must NEVER depend on @khidi/publishing
    expect(productsPkg.dependencies["@khidi/publishing"]).toBeUndefined();
    expect(pricingPkg.dependencies["@khidi/publishing"]).toBeUndefined();
    expect(inventoryPkg.dependencies["@khidi/publishing"]).toBeUndefined();
  });

  it("verifies production CSP omits 'unsafe-eval', Service Worker never caches '/', and iOS PNG icons exist ([C6])", () => {
    const nextConfigContent = readFileSync(
      join(repoRoot, "apps", "hub", "next.config.ts"),
      "utf8"
    );
    expect(nextConfigContent).toContain("X-Robots-Tag");
    expect(nextConfigContent).toContain("noindex, nofollow, noarchive, nosnippet");
    expect(nextConfigContent).toContain('isProduction\n    ? "script-src \'self\' \'unsafe-inline\'"');

    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "apps", "hub", "public", "manifest.webmanifest"), "utf8")
    ) as {
      name: string;
      short_name: string;
      icons: Array<{ src: string; purpose: string; type: string }>;
    };

    expect(manifest.short_name).toBe("Khidi");
    expect(manifest.name).toContain("Khidi");
    // Must not combine "any maskable" into one icon entry
    expect(manifest.icons.some((i) => i.purpose === "any maskable")).toBe(false);
    expect(manifest.icons.some((i) => i.purpose === "any" && i.type === "image/png")).toBe(true);
    expect(manifest.icons.some((i) => i.purpose === "maskable" && i.type === "image/png")).toBe(
      true
    );

    // iOS apple-touch-icon.png must exist
    expect(
      existsSync(join(repoRoot, "apps", "hub", "public", "icons", "apple-touch-icon.png"))
    ).toBe(true);

    // Service Worker must not precache "/" and must clear caches on CLEAR_AUTH_CACHES
    const swContent = readFileSync(join(repoRoot, "apps", "hub", "public", "sw.js"), "utf8");
    expect(swContent).not.toContain('  "/",');
    expect(swContent).toContain('event.request.mode === "navigate"');
    expect(swContent).toContain("CLEAR_AUTH_CACHES");
  });

  it("verifies ADR-001 ([C12]), ADR-002 ([C6]), and ADR-003 (Custom Session Auth) are documented", () => {
    const adr1 = readFileSync(
      join(repoRoot, "docs", "adr", "ADR-001-single-user-role-and-entity-memberships.md"),
      "utf8"
    );
    const adr2 = readFileSync(
      join(repoRoot, "docs", "adr", "ADR-002-access-gateway-pwa-configuration.md"),
      "utf8"
    );
    const adr3 = readFileSync(
      join(repoRoot, "docs", "adr", "ADR-003-custom-database-session-and-device-auth.md"),
      "utf8"
    );

    expect(adr1).toContain("user_entity_memberships");
    expect(adr2).toContain('crossorigin="use-credentials"');
    expect(adr3).toContain("AES-256-GCM");
  });

  it("enforces requirePageAuth() and ADMIN RBAC on Hub App pages and proxy, and exhaustively scans all page.tsx and route.ts files", () => {
    const proxySrc = readFileSync(
      join(repoRoot, "apps", "hub", "src", "proxy.ts"),
      "utf8"
    );
    expect(proxySrc).toContain("khidi_session");
    expect(proxySrc).toContain("private, no-store, no-cache, must-revalidate");

    const appDir = join(repoRoot, "apps", "hub", "src", "app");
    const allPages = collectFilesRecursively(appDir, (f) => f.endsWith("page.tsx"));
    const allRoutes = collectFilesRecursively(appDir, (f) => f.endsWith("route.ts"));

    expect(allPages.length).toBeGreaterThanOrEqual(7);
    expect(allRoutes.length).toBeGreaterThanOrEqual(5);

    const publicPageRelPaths = new Set(["login/page.tsx"]);
    for (const pageFile of allPages) {
      const relPath = relative(appDir, pageFile).replace(/\\/g, "/");
      const content = readFileSync(pageFile, "utf8");
      if (!publicPageRelPaths.has(relPath)) {
        expect(
          content.includes("requirePageAuth("),
          `Non-public page "${relPath}" is missing mandatory requirePageAuth() session check!`
        ).toBe(true);
      }
    }

    const publicRouteRelPaths = new Set([
      "api/health/route.ts",
      "api/auth/office-login/route.ts",
      "api/auth/warehouse-pin/route.ts",
      "api/auth/logout/route.ts"
    ]);
    for (const routeFile of allRoutes) {
      const relPath = relative(appDir, routeFile).replace(/\\/g, "/");
      const content = readFileSync(routeFile, "utf8");
      if (!publicRouteRelPaths.has(relPath)) {
        const hasAuthGuard =
          content.includes("getCurrentPrincipal(") ||
          content.includes("requirePageAuth(") ||
          content.includes("verifyStorefrontServiceCredential(");
        expect(
          hasAuthGuard,
          `Non-public API route "${relPath}" is missing mandatory server-side authentication check!`
        ).toBe(true);
      }
    }

    const adminPages = ["users", "entities", "storefronts", "settings"];
    for (const page of adminPages) {
      const content = readFileSync(
        join(repoRoot, "apps", "hub", "src", "app", page, "page.tsx"),
        "utf8"
      );
      expect(content).toContain('requirePageAuth({ allowedRoles: ["ADMIN"] })');
    }
  });
});

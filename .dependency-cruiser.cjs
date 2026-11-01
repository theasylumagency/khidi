/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "[C5] Circular dependencies between modules or files are strictly forbidden.",
      from: {},
      to: {
        circular: true
      }
    },
    {
      name: "products-must-not-import-commerce-or-publishing",
      severity: "error",
      comment: "[C5] packages/products must never import pricing, inventory, fulfillment, or publishing.",
      from: {
        path: "^packages/products/"
      },
      to: {
        path: "^packages/(pricing|inventory|fulfillment|publishing|reports|notifications)/"
      }
    },
    {
      name: "lower-layers-must-not-import-publishing",
      severity: "error",
      comment: "[C5] None of products, entities, pricing, inventory, or media may depend on packages/publishing.",
      from: {
        path: "^packages/(shared|db|domain|auth|entities|products|evidence|media|scanning|ai|pricing|inventory)/"
      },
      to: {
        path: "^packages/publishing/"
      }
    },
    {
      name: "shared-must- remain-pure",
      severity: "error",
      comment: "packages/shared must not import any other internal workspace package.",
      from: {
        path: "^packages/shared/"
      },
      to: {
        path: "^(packages/(?!shared/)|apps/)"
      }
    },
    {
      name: "db-must-only-depend-on-shared",
      severity: "error",
      comment: "packages/db may only depend on packages/shared.",
      from: {
        path: "^packages/db/"
      },
      to: {
        path: "^(packages/(?!(db|shared)/)|apps/)"
      }
    },
    {
      name: "domain-must-only-depend-on-db-and-shared",
      severity: "error",
      comment: "packages/domain may only depend on packages/db and packages/shared.",
      from: {
        path: "^packages/domain/"
      },
      to: {
        path: "^(packages/(?!(domain|db|shared)/)|apps/)"
      }
    },
    {
      name: "packages-must-not-import-apps",
      severity: "error",
      comment: "Domain/library packages must never import from apps/*.",
      from: {
        path: "^packages/"
      },
      to: {
        path: "^apps/"
      }
    }
  ],
  options: {
    doNotFollow: {
      path: "node_modules"
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.base.json"
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "default"]
    }
  }
};

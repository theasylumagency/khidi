import { beforeAll, describe, expect, it } from "vitest";
import { getDb, runMigrations, runSeed } from "@khidi/db";
import {
  getActiveEntityRelationship,
  listLegalEntities,
  listStorefronts,
  setEntityRelationship
} from "./index.ts";

describe("@khidi/entities — VAT Defaults [C11] & Relationship Mode Guard [C17]", () => {
  beforeAll(async () => {
    await runMigrations();
    await runSeed();
  });

  it("exposes per-entity pricesIncludeVat defaults and maps them to storefronts [C11]", async () => {
    const db = getDb();
    const entities = await listLegalEntities(db);
    const agro = entities.find((e) => e.key === "AGROTRADE");
    const newBrand = entities.find((e) => e.key === "NEWBRAND");

    expect(agro?.pricesIncludeVat).toBe(true);
    expect(newBrand?.pricesIncludeVat).toBe(false);

    const stores = await listStorefronts(db);
    const agroStore = stores.find((s) => s.key === "store-a");
    const newBrandStore = stores.find((s) => s.key === "store-b");

    expect(agroStore?.sellerPricesIncludeVat).toBe(true);
    expect(newBrandStore?.sellerPricesIncludeVat).toBe(false);
  });

  it("blocks CONSIGNMENT -> PURCHASE when open cross-entity reservations/commitments exist, and allows after draining [C17]", async () => {
    const db = getDb();
    const admin=(await db.query.users.findFirst({where:(u,{eq})=>eq(u.role,"ADMIN")}))!;
    const entities = await listLegalEntities(db);
    const agro = entities.find((e) => e.key === "AGROTRADE")!;
    const newBrand = entities.find((e) => e.key === "NEWBRAND")!;

    // Ensure starting mode is CONSIGNMENT
    await setEntityRelationship(
      db,
      { userId:admin.id, correlationId: "cor_c17_setup" },
      {
        fromEntityId: agro.id,
        toEntityId: newBrand.id,
        mode: "CONSIGNMENT",
        notes: "Setup CONSIGNMENT"
      }
    );

    // Attempt to switch to PURCHASE while open reservations exist -> must reject
    await expect(
      setEntityRelationship(
        db,
        { userId:admin.id, correlationId: "cor_c17_blocked" },
        {
          fromEntityId: agro.id,
          toEntityId: newBrand.id,
          mode: "PURCHASE",
          notes: "Attempt switch while open commitments exist"
        },
        {
          hasOpenCrossEntityCommitmentsOrReservations: async () => true
        }
      )
    ).rejects.toThrow(/CONSIGNMENT -> PURCHASE/);

    // After draining open reservations/commitments -> must succeed
    await setEntityRelationship(
      db,
      { userId:admin.id, correlationId: "cor_c17_allowed" },
      {
        fromEntityId: agro.id,
        toEntityId: newBrand.id,
        mode: "PURCHASE",
        notes: "Drained and switched to PURCHASE"
      },
      {
        hasOpenCrossEntityCommitmentsOrReservations: async () => false
      }
    );

    const active = await getActiveEntityRelationship(db, agro.id, newBrand.id);
    expect(active?.mode).toBe("PURCHASE");
  });
});

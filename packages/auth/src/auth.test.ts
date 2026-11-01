import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  getDb,
  legalEntities,
  storefronts,
  users,
  runMigrations,
  runSeed,
  SEED_CONSTANTS
} from "@agrotrade/db";
import {
  assertEntityStockManagement,
  assertPriceEditAccess,
  assertPriceViewAccess,
  canAccessAdminScreens,
  canViewCommercialInvoices,
  canViewPrices,
  generateCurrentTotpToken,
  issueStorefrontApiKey,
  loginOfficeUser,
  loginWithWarehousePin,
  registerWarehouseDevice,
  revokeWarehouseDevice,
  verifySessionToken,
  verifyStorefrontServiceCredential
} from "./index.ts";

describe("@agrotrade/auth — Office TOTP, Warehouse PIN, RBAC & Storefront Isolation (§13, §17.1)", () => {
  beforeAll(async () => {
    await runMigrations();
    await runSeed();
  });

  it("enforces mandatory TOTP for ADMIN and STOCK_MANAGER and allows valid TOTP login (§13.2)", async () => {
    const db = getDb();

    // Missing TOTP must fail for ADMIN
    await expect(
      loginOfficeUser(db, {
        email: "admin@agrotrade.local",
        password: SEED_CONSTANTS.DEFAULT_PASSWORD
      })
    ).rejects.toThrow(/TOTP/);

    // Valid TOTP must succeed
    const validTotp = generateCurrentTotpToken(SEED_CONSTANTS.ADMIN_TOTP_SECRET);
    const { sessionToken, principal } = await loginOfficeUser(db, {
      email: "admin@agrotrade.local",
      password: SEED_CONSTANTS.DEFAULT_PASSWORD,
      totpCode: validTotp
    });

    expect(principal.role).toBe("ADMIN");
    expect(canAccessAdminScreens(principal)).toBe(true);
    expect(canViewCommercialInvoices(principal)).toBe(true);

    const verified = await verifySessionToken(db, sessionToken);
    expect(verified.userId).toBe(principal.userId);
  });

  it("restricts WAREHOUSE role from admin, price data, and commercial invoices (§13.1, §17.1)", async () => {
    const db = getDb();
    const [warehouseUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, "warehouse.giorgi@agrotrade.local"))
      .limit(1);

    const { principal } = await loginWithWarehousePin(db, {
      rawDeviceToken: SEED_CONSTANTS.WAREHOUSE_DEVICE_TOKEN,
      userId: warehouseUser!.id,
      pin: SEED_CONSTANTS.WAREHOUSE_PIN
    });

    expect(principal.role).toBe("WAREHOUSE");
    expect(canAccessAdminScreens(principal)).toBe(false);
    expect(canViewPrices(principal)).toBe(false);
    expect(canViewCommercialInvoices(principal)).toBe(false);
    expect(() => assertPriceViewAccess(principal)).toThrow();
    expect(() => assertPriceEditAccess(principal)).toThrow();
  });

  it("limits STOCK_MANAGER strictly to their own legal entity (§13.1, §17.1)", async () => {
    const db = getDb();
    const allEntities = await db.select().from(legalEntities);
    const agro = allEntities.find((e) => e.key === "AGROTRADE")!;
    const newBrand = allEntities.find((e) => e.key === "NEWBRAND")!;

    const validTotp = generateCurrentTotpToken(SEED_CONSTANTS.STOCK_MANAGER_TOTP_SECRET);
    const { principal: agroStockMgr } = await loginOfficeUser(db, {
      email: "stock.agro@agrotrade.local",
      password: SEED_CONSTANTS.DEFAULT_PASSWORD,
      totpCode: validTotp
    });

    // Can manage AGROTRADE stock
    expect(() => assertEntityStockManagement(agroStockMgr, agro.id)).not.toThrow();

    // Cannot manage NEWBRAND stock
    expect(() => assertEntityStockManagement(agroStockMgr, newBrand.id)).toThrow(/cannot manage stock/);
  });

  it("supports warehouse device registration and immediate session revocation by ADMIN (§13.2)", async () => {
    const db = getDb();
    const validTotp = generateCurrentTotpToken(SEED_CONSTANTS.ADMIN_TOTP_SECRET);
    const { principal: adminPrincipal } = await loginOfficeUser(db, {
      email: "admin@agrotrade.local",
      password: SEED_CONSTANTS.DEFAULT_PASSWORD,
      totpCode: validTotp
    });

    const [warehouseUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, "warehouse.giorgi@agrotrade.local"))
      .limit(1);

    const registered = await registerWarehouseDevice(db, adminPrincipal, {
      deviceName: "Warehouse Scanner #2"
    });

    const { sessionToken } = await loginWithWarehousePin(db, {
      rawDeviceToken: registered.rawDeviceToken,
      userId: warehouseUser!.id,
      pin: SEED_CONSTANTS.WAREHOUSE_PIN
    });

    await revokeWarehouseDevice(db, adminPrincipal, {
      deviceId: registered.deviceId,
      reason: "Phone lost"
    });

    await expect(verifySessionToken(db, sessionToken)).rejects.toThrow();
  });

  it("enforces strict per-storefront credential isolation (§12.1, §17.1)", async () => {
    const db = getDb();
    const validTotp = generateCurrentTotpToken(SEED_CONSTANTS.ADMIN_TOTP_SECRET);
    const { principal: adminPrincipal } = await loginOfficeUser(db, {
      email: "admin@agrotrade.local",
      password: SEED_CONSTANTS.DEFAULT_PASSWORD,
      totpCode: validTotp
    });

    const [agroStore] = await db
      .select()
      .from(storefronts)
      .where(eq(storefronts.key, "agrotrade-ge"))
      .limit(1);

    const issued = await issueStorefrontApiKey(db, adminPrincipal, {
      storefrontId: agroStore!.id,
      name: "Storefront A Production Key"
    });

    // Accessing own storefront succeeds
    const verified = await verifyStorefrontServiceCredential(db, {
      requestedStorefrontKey: "agrotrade-ge",
      rawApiKey: issued.rawApiKey
    });
    expect(verified.storefrontKey).toBe("agrotrade-ge");

    // Accessing another storefront with Storefront A's key is strictly forbidden
    await expect(
      verifyStorefrontServiceCredential(db, {
        requestedStorefrontKey: "newbrand-ge",
        rawApiKey: issued.rawApiKey
      })
    ).rejects.toThrow(/cannot access "newbrand-ge"/);
  });
});

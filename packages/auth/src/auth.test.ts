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
} from "@khidi/db";
import {
  assertEntityStockManagement,
  assertPriceEditAccess,
  assertPriceViewAccess,
  canAccessAdminScreens,
  canViewCommercialInvoices,
  canViewPrices,
  decryptTotpSecret,
  encryptTotpSecret,
  generateCurrentTotpToken,
  generateTotpSecret,
  issueStorefrontApiKey,
  isWarehouseBrowser,
  listPinEnabledUsersForRegisteredDevice,
  listUsersWithMemberships,
  loginOfficeUser,
  loginWithWarehousePin,
  registerWarehouseDevice,
  revokeSessionToken,
  revokeWarehouseDevice,
  verifySessionToken,
  verifyStorefrontServiceCredential
} from "./index.ts";

describe("@khidi/auth — AES-256-GCM TOTP, Atomic Lockouts, Warehouse PIN, RBAC & Storefront Isolation (§13, §17.1)", () => {
  beforeAll(async () => {
    await runMigrations();
    await runSeed();
  });

  it("encrypts TOTP secrets at rest with AES-256-GCM and uses Khidi issuer", async () => {
    const db = getDb();
    const [adminRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "admin@agrotrade.local"))
      .limit(1);

    expect(adminRow?.totpSecretEncrypted).toBeDefined();
    // Must not be stored as plaintext Base32
    expect(adminRow?.totpSecretEncrypted).not.toBe(SEED_CONSTANTS.ADMIN_TOTP_SECRET);
    expect(adminRow?.totpSecretEncrypted?.startsWith("v1:")).toBe(true);

    // Decrypts back to the exact Base32 secret with valid key
    const decrypted = decryptTotpSecret(adminRow!.totpSecretEncrypted!);
    expect(decrypted).toBe(SEED_CONSTANTS.ADMIN_TOTP_SECRET);

    // Fails decryption with a wrong key
    expect(() =>
      decryptTotpSecret(
        adminRow!.totpSecretEncrypted!,
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
      )
    ).toThrow(/Failed to decrypt/);

    // Generated TOTP URI uses neutral "Khidi" issuer
    const enrolled = generateTotpSecret("test@khidi.local");
    expect(enrolled.otpauthUri).toContain("issuer=Khidi");
    expect(decryptTotpSecret(enrolled.encryptedSecret)).toBe(enrolled.base32Secret);
    expect(encryptTotpSecret(enrolled.base32Secret)).not.toBe(enrolled.encryptedSecret); // random IV
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

    // Valid TOTP must succeed and reset failed_login_attempts to 0
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

  it("enforces atomic brute-force lockout after 5 failed office logins and supports session logout", async () => {
    const db = getDb();

    // 5 failed password attempts for orders@agrotrade.local
    for (let i = 0; i < 5; i++) {
      await expect(
        loginOfficeUser(db, {
          email: "orders@agrotrade.local",
          password: "WrongPassword#123"
        })
      ).rejects.toThrow(/Invalid email or password/);
    }

    // Even with the correct password, the 6th attempt must be blocked by login_locked_until
    await expect(
      loginOfficeUser(db, {
        email: "orders@agrotrade.local",
        password: SEED_CONSTANTS.DEFAULT_PASSWORD
      })
    ).rejects.toThrow(/temporarily locked/);

    // Clear lockout for subsequent tests and verify logout revokes session
    await db
      .update(users)
      .set({ failedLoginAttempts: 0, loginLockedUntil: null })
      .where(eq(users.email, "orders@agrotrade.local"));

    const { sessionToken } = await loginOfficeUser(db, {
      email: "orders@agrotrade.local",
      password: SEED_CONSTANTS.DEFAULT_PASSWORD
    });

    await revokeSessionToken(db, sessionToken);
    await expect(verifySessionToken(db, sessionToken)).rejects.toThrow(/Session expired or invalid/);
  });

  it("restricts WAREHOUSE role from admin, price data, user list, and commercial invoices (§13.1, §17.1)", async () => {
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
    await expect(listUsersWithMemberships(db, principal)).rejects.toThrow(/not permitted/);

    // Registered device user listing never leaks emails and returns null for unknown device tokens
    const unreg = await listPinEnabledUsersForRegisteredDevice(db, "unknown_device_token");
    expect(unreg).toBeNull();

    const regContext = await listPinEnabledUsersForRegisteredDevice(
      db,
      SEED_CONSTANTS.WAREHOUSE_DEVICE_TOKEN
    );
    expect(regContext).not.toBeNull();
    expect(regContext!.users.length).toBeGreaterThan(0);
    expect("email" in (regContext!.users[0] as Record<string, unknown>)).toBe(false);
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
    expect(await isWarehouseBrowser(db, registered.rawDeviceToken)).toBe(true);
    expect(await isWarehouseBrowser(db, "unknown-device-token")).toBe(false);
    expect(await isWarehouseBrowser(db, undefined)).toBe(false);
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

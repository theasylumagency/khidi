import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createUuidV7, sha256Hex } from "@agrotrade/shared";
import { getDb, closeAppPool } from "./client.ts";
import {
  legalEntities,
  users,
  entityRelationships,
  storefronts,
  userEntityMemberships,
  userPermissions,
  registeredDevices,
  systemSettings,
  auditLogs
} from "./schema.ts";

export const SEED_CONSTANTS = {
  ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXP",
  STOCK_MANAGER_TOTP_SECRET: "JBSWY3DPEHPK3PXQ",
  DEFAULT_PASSWORD: "AgroTrade#2026!",
  WAREHOUSE_PIN: "1482",
  WAREHOUSE_DEVICE_TOKEN: "agt_dev_seed_scanner_01_token_998877665544332211"
} as const;

export async function runSeed() {
  const db = getDb();

  // Check if AGROTRADE entity already exists
  const existingAgro = await db
    .select()
    .from(legalEntities)
    .where(eq(legalEntities.key, "AGROTRADE"))
    .limit(1);

  if (existingAgro.length > 0) {
    return { skipped: true };
  }

  const passwordHash = await bcrypt.hash(SEED_CONSTANTS.DEFAULT_PASSWORD, 10);
  const pinHash = await bcrypt.hash(SEED_CONSTANTS.WAREHOUSE_PIN, 10);

  const agroEntityId = createUuidV7();
  const newBrandEntityId = createUuidV7();

  await db.insert(legalEntities).values([
    {
      id: agroEntityId,
      key: "AGROTRADE",
      legalName: "შპს აგროთრეიდი (AgroTrade LLC)",
      taxId: "400123456",
      pricesIncludeVat: true, // [C11] VAT payer
      active: true
    },
    {
      id: newBrandEntityId,
      key: "NEWBRAND",
      legalName: "შპს ახალი აგრო ბრენდი (NewBrand LLC)",
      taxId: "400987654",
      pricesIncludeVat: false, // [C11] Non-VAT default example
      active: true
    }
  ]);

  const adminId = createUuidV7();
  const operatorId = createUuidV7();
  const agroStockMgrId = createUuidV7();
  const newBrandStockMgrId = createUuidV7();
  const warehouseUserId = createUuidV7();
  const orderManagerId = createUuidV7();

  await db.insert(users).values([
    {
      id: adminId,
      email: "admin@agrotrade.local",
      fullName: "გიორგი ბერიძე (Admin)",
      passwordHash,
      totpSecretEncrypted: SEED_CONSTANTS.ADMIN_TOTP_SECRET,
      totpEnabled: true,
      pinHash,
      role: "ADMIN",
      locale: "ka",
      active: true
    },
    {
      id: operatorId,
      email: "operator@agrotrade.local",
      fullName: "ნინო კაპანაძე (Operator)",
      passwordHash,
      totpEnabled: false,
      role: "OPERATOR",
      locale: "ka",
      active: true
    },
    {
      id: agroStockMgrId,
      email: "stock.agro@agrotrade.local",
      fullName: "ლიკა მaisuradze (AgroTrade Stock Manager)",
      passwordHash,
      totpSecretEncrypted: SEED_CONSTANTS.STOCK_MANAGER_TOTP_SECRET,
      totpEnabled: true,
      role: "STOCK_MANAGER",
      locale: "ka",
      active: true
    },
    {
      id: newBrandStockMgrId,
      email: "stock.newbrand@agrotrade.local",
      fullName: "დავით გელაშვილი (NewBrand Stock Manager)",
      passwordHash,
      totpSecretEncrypted: SEED_CONSTANTS.STOCK_MANAGER_TOTP_SECRET,
      totpEnabled: true,
      role: "STOCK_MANAGER",
      locale: "ka",
      active: true
    },
    {
      id: warehouseUserId,
      email: "warehouse.giorgi@agrotrade.local",
      fullName: "ლევან ლომიძე (საწყობი)",
      passwordHash,
      totpEnabled: false,
      pinHash,
      role: "WAREHOUSE",
      locale: "ka",
      active: true
    },
    {
      id: orderManagerId,
      email: "orders@agrotrade.local",
      fullName: "თამარ წერეთელი (Order Manager)",
      passwordHash,
      totpEnabled: false,
      role: "ORDER_MANAGER",
      locale: "ka",
      active: true
    }
  ]);

  await db.insert(userEntityMemberships).values([
    {
      userId: adminId,
      legalEntityId: agroEntityId,
      isStockManagerRecipient: true,
      isReportRecipient: true
    },
    {
      userId: adminId,
      legalEntityId: newBrandEntityId,
      isStockManagerRecipient: true,
      isReportRecipient: true
    },
    {
      userId: operatorId,
      legalEntityId: agroEntityId,
      isStockManagerRecipient: false,
      isReportRecipient: false
    },
    {
      userId: operatorId,
      legalEntityId: newBrandEntityId,
      isStockManagerRecipient: false,
      isReportRecipient: false
    },
    {
      userId: agroStockMgrId,
      legalEntityId: agroEntityId,
      isStockManagerRecipient: true,
      isReportRecipient: true
    },
    {
      userId: newBrandStockMgrId,
      legalEntityId: newBrandEntityId,
      isStockManagerRecipient: true,
      isReportRecipient: true
    },
    {
      userId: warehouseUserId,
      legalEntityId: agroEntityId,
      isStockManagerRecipient: false,
      isReportRecipient: false
    },
    {
      userId: warehouseUserId,
      legalEntityId: newBrandEntityId,
      isStockManagerRecipient: false,
      isReportRecipient: false
    },
    {
      userId: orderManagerId,
      legalEntityId: agroEntityId,
      isStockManagerRecipient: false,
      isReportRecipient: false
    },
    {
      userId: orderManagerId,
      legalEntityId: newBrandEntityId,
      isStockManagerRecipient: false,
      isReportRecipient: false
    }
  ]);

  await db.insert(userPermissions).values([
    {
      userId: operatorId,
      permissionKey: "price.edit",
      grantedBy: adminId
    }
  ]);

  await db.insert(entityRelationships).values({
    id: createUuidV7(),
    fromEntityId: agroEntityId,
    toEntityId: newBrandEntityId,
    mode: "CONSIGNMENT",
    effectiveFrom: new Date("2026-11-01T00:00:00Z"),
    notes: "Initial seed relationship mode (configurable per §4.4, C17)",
    createdBy: adminId
  });

  await db.insert(storefronts).values([
    {
      id: createUuidV7(),
      key: "agrotrade-ge",
      name: "AgroTrade Main Storefront",
      domain: "agro-trade.ge",
      sellerEntityId: agroEntityId,
      mediaBaseUrl: "https://media.agro-trade.ge",
      webhookUrl: "https://agro-trade.ge/api/hub-webhooks"
    },
    {
      id: createUuidV7(),
      key: "newbrand-ge",
      name: "NewBrand Storefront",
      domain: "newbrand-agro.ge",
      sellerEntityId: newBrandEntityId,
      mediaBaseUrl: "https://media.newbrand-agro.ge",
      webhookUrl: "https://newbrand-agro.ge/api/hub-webhooks"
    }
  ]);

  await db.insert(registeredDevices).values({
    id: createUuidV7(),
    deviceName: "Warehouse Scanner #1 (Zebra/Android)",
    deviceTokenHash: sha256Hex(SEED_CONSTANTS.WAREHOUSE_DEVICE_TOKEN),
    registeredBy: adminId,
    active: true
  });

  await db.insert(systemSettings).values([
    {
      key: "operating_model",
      valueJson: {
        dedicatedAccountingWarehouseRequired: true,
        physicallyMarkedPoolShelfAndStagingRequired: true, // [C13]
        returnsAfterHandoverOutsideHub: true, // [C1]
        returnedGoodsGoToMainWarehouseOnly: true // [C1]
      },
      description:
        "Operating model rules (§10.1, C1, C13): physically marked SHELF/STAGING per pool; returns after HANDED_OVER go to main warehouse only.",
      updatedBy: adminId
    },
    {
      key: "pricing_rules",
      valueJson: {
        largePriceChangeReasonThresholdRatio: 0.3
      },
      description: "Price change confirmation threshold (§9.1).",
      updatedBy: adminId
    }
  ]);

  await db.insert(auditLogs).values({
    id: createUuidV7(),
    actorUserId: adminId,
    action: "SYSTEM_SEED_INITIALIZED",
    entityType: "system",
    entityId: "milestone-1-seed",
    afterJson: {
      entities: ["AGROTRADE", "NEWBRAND"],
      storefronts: ["agrotrade-ge", "newbrand-ge"]
    },
    correlationId: "cor_seed_m1"
  });

  return { skipped: false };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("seed.ts")) {
  runSeed()
    .then(async (res) => {
      console.log("Seed completed:", res);
      await closeAppPool();
    })
    .catch(async (err) => {
      console.error("Seed failed:", err);
      await closeAppPool();
      process.exit(1);
    });
}

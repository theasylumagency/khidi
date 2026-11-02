import { eq } from "drizzle-orm";
import {
  closeAppPool,
  getDb,
  legalEntities,
  skus,
  storefronts,
  users
} from "@khidi/db";
import {
  attachSkuIdentifier,
  createProductFamily,
  createSkuDraft,
  registerLegacyUrl,
  seedTaxonomyAndProductTypes,
  setComposedBundleComponents,
  setStorefrontListing,
  transitionSkuToReady,
  upsertAccountingMapping
} from "./index.ts";

export async function runProductsSeed() {
  const db = getDb();

  // 1. Always ensure 9 categories (8 public + UNCLASSIFIED) and 30 initial Product Types exist
  const taxonomyStats = await seedTaxonomyAndProductTypes(db);

  // 2. Check if initial seed SKU AGT-000184 already exists
  const [existingSku] = await db
    .select()
    .from(skus)
    .where(eq(skus.internalSku, "AGT-000184"))
    .limit(1);

  if (existingSku) {
    return { skipped: true, ...taxonomyStats };
  }

  const [adminUser] = await db
    .select()
    .from(users)
    .where(eq(users.role, "ADMIN"))
    .limit(1);

  const [agroEntity] = await db
    .select()
    .from(legalEntities)
    .where(eq(legalEntities.key, "AGROTRADE"))
    .limit(1);

  const [newBrandEntity] = await db
    .select()
    .from(legalEntities)
    .where(eq(legalEntities.key, "NEWBRAND"))
    .limit(1);

  const [agroStorefront] = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.key, "agrotrade-ge"))
    .limit(1);

  if (!adminUser || !agroEntity || !newBrandEntity || !agroStorefront) {
    throw new Error("Foundation seed must run before products seed.");
  }

  const actor = { userId: adminUser.id };

  // Look up product types
  const allTypes = await db.query?.productTypes?.findMany?.() ?? [];
  const { listProductTypes } = await import("./index.ts");
  const typesList = allTypes.length > 0 ? allTypes : await listProductTypes(db);
  const typeByKey = new Map(typesList.map((t) => [t.key, t]));

  const motoblockType = typeByKey.get("MOTOBLOCK")!;
  const attachmentType = typeByKey.get("AGRI_ATTACHMENT")!;
  const trailerType = typeByKey.get("TRAILER")!;

  // 3. Create Product Family: HIROMIKI 178FE (§5.1)
  const hiromikiFamily = await createProductFamily(db, actor, {
    code: "HIROMIKI-178FE",
    productTypeId: motoblockType.id,
    categoryId: motoblockType.defaultCategoryId,
    brand: "HIROMIKI",
    manufacturer: "HIROMIKI Power Equipment",
    baseModel: "D178E-DF900Q",
    titleKa: "HIROMIKI D178E-DF900Q დიზელის მოტობლოკის ოჯახი",
    titleEn: "HIROMIKI D178E-DF900Q Diesel Motoblock Series"
  });

  // 4. Variant 1: AGT-000184 — 9 HP Diesel Motoblock with Rubber Wheels -> READY ([C8])
  const skuRubber = await createSkuDraft(db, actor, {
    internalSku: "AGT-000184",
    productFamilyId: hiromikiFamily.id,
    productTypeId: motoblockType.id,
    lifecycleState: "CONTENT_REVIEW",
    identityConfidence: "HIGH",
    brand: "HIROMIKI",
    manufacturer: "HIROMIKI Power Equipment",
    modelCode: "D178E-DF900Q",
    keyDifferentiatorKa: "9 ცხ.ძ., რეზინის ბორბლებით",
    keyDifferentiatorEn: "9 HP, Rubber Wheels",
    universalUnits: {
      power: "9 HP", // -> 6.62 kW (§5.6)
      engineDisplacement: "418 cc",
      workingWidth: "110 cm",
      workingDepth: "30 cm",
      weight: "135 kg"
    },
    typeAttributes: {
      fuel_type: { value: "DIESEL", status: "VERIFIED", sourceType: "PLATE" },
      engine_model: { value: "186FA", status: "VERIFIED", sourceType: "PLATE" },
      start_type: { value: "ELECTRIC_STARTER", status: "VERIFIED", sourceType: "SPEC_SHEET" },
      transmission_gears: { value: "2 წინ + 1 უკან", status: "VERIFIED", sourceType: "SPEC_SHEET" },
      wheel_size: { value: "4.00-10", status: "VERIFIED", sourceType: "PHOTO" },
      wheel_type: { value: "RUBBER", status: "VERIFIED", sourceType: "PHOTO" },
      pto_shaft: { value: true, status: "VERIFIED", sourceType: "SPEC_SHEET" }
    },
    shortDescriptionKa: "9 ცხ.ძ. დიზელის მოტობლოკი ელექტრო სტარტერით, 4.00-10 რეზინის ბორბლებით და 32 დანიანი ფრეზით.",
    shortDescriptionEn: "9 HP diesel motoblock with electric starter, 4.00-10 rubber wheels, and 32-blade rotary tiller."
  });

  await attachSkuIdentifier(db, actor, {
    skuId: skuRubber.id,
    identifierType: "GTIN",
    value: "4860001840012",
    issuerSource: "PACKAGING",
    verified: true,
    isPrimary: false
  });

  // Accounting mappings for both AGROTRADE and NEWBRAND ([C9])
  await upsertAccountingMapping(db, actor, {
    skuId: skuRubber.id,
    legalEntityId: agroEntity.id,
    accountingItemId: "1610/00004/0009",
    accountingName: "მოტობლოკი HIROMIKI D178E-DF900Q 9HP (რეზინის საბურავი)",
    legacyCode: "HM-178E-RUB"
  });

  await upsertAccountingMapping(db, actor, {
    skuId: skuRubber.id,
    legalEntityId: newBrandEntity.id,
    accountingItemId: "NB-1610/0009",
    accountingName: "HIROMIKI D178E-DF900Q 9HP Diesel Tiller",
    legacyCode: "NB-HM178E"
  });

  // Transition AGT-000184 to READY — assigns canonical_slug = 'hiromiki-d178e-df900q' ([C8])
  await transitionSkuToReady(db, actor, skuRubber.id);

  // Enable Storefront Listing on agrotrade-ge (§4.5)
  await setStorefrontListing(db, actor, {
    storefrontId: agroStorefront.id,
    skuId: skuRubber.id,
    enabled: true,
    reason: "Initial READY catalog item on AgroTrade storefront"
  });

  // 5. Variant 2: AGT-000185 — 9 HP Diesel Motoblock with Iron Wheels (§5.1 separate SKU, in INTAKE with NULL slug [C8])
  const skuIron = await createSkuDraft(db, actor, {
    internalSku: "AGT-000185",
    productFamilyId: hiromikiFamily.id,
    productTypeId: motoblockType.id,
    lifecycleState: "INTAKE",
    identityConfidence: "MEDIUM",
    brand: "HIROMIKI",
    modelCode: "D178E-DF900Q-IRON",
    keyDifferentiatorKa: "9 ცხ.ძ., რკინის ბორბლებით",
    keyDifferentiatorEn: "9 HP, Iron Wheels",
    universalUnits: {
      power: "9 HP",
      workingWidth: "110 cm",
      weight: "142 kg"
    },
    typeAttributes: {
      fuel_type: { value: "DIESEL", status: "VERIFIED" },
      engine_model: { value: "186FA", status: "UNVERIFIED" },
      wheel_type: { value: "IRON", status: "VERIFIED" }
    }
  });

  // 6. Component SKUs for Composed Bundle: Plough (AGT-000186) & Trailer (AGT-000187)
  const skuPlough = await createSkuDraft(db, actor, {
    internalSku: "AGT-000186",
    productTypeId: attachmentType.id,
    lifecycleState: "IDENTIFIED",
    identityConfidence: "HIGH",
    brand: "WEIMA",
    modelCode: "WM-PL01",
    keyDifferentiatorKa: "ერთფრთიანი გუთანი",
    keyDifferentiatorEn: "Single Furrow Plough",
    universalUnits: {
      workingDepth: "22 cm",
      weight: "18 kg"
    },
    typeAttributes: {
      attachment_kind: { value: "PLOUGH", status: "VERIFIED" },
      compatible_mount: { value: "HIROMIKI / WEIMA 178-186 სერია", status: "VERIFIED" }
    }
  });

  const skuTrailer = await createSkuDraft(db, actor, {
    internalSku: "AGT-000187",
    productTypeId: trailerType.id,
    lifecycleState: "IDENTIFIED",
    identityConfidence: "HIGH",
    brand: "WEIMA",
    modelCode: "WM-7C-500",
    keyDifferentiatorKa: "500 კგ თვითმცლელი მისაბმელი",
    keyDifferentiatorEn: "500 kg Tipping Trailer",
    universalUnits: {
      length: "180 cm",
      width: "120 cm",
      weight: "145 kg"
    },
    typeAttributes: {
      payload_capacity_kg: { value: 500, status: "VERIFIED" },
      brake_type: { value: "MECHANICAL_DRUM", status: "VERIFIED" },
      dumping_bed: { value: true, status: "VERIFIED" }
    }
  });

  // 7. Composed Bundle SKU: AGT-000188 (Motoblock × 1 + Plough × 1 + Trailer × 1, §5.2)
  const skuBundle = await createSkuDraft(db, actor, {
    internalSku: "AGT-000188",
    productTypeId: motoblockType.id,
    lifecycleState: "IDENTIFIED",
    identityConfidence: "HIGH",
    isComposedBundle: true,
    brand: "HIROMIKI",
    modelCode: "D178E-AGRO-SET",
    keyDifferentiatorKa: "სრული კომპლექტი (მოტობლოკი + გუთანი + მისაბმელი)",
    keyDifferentiatorEn: "Full Bundle (Motoblock + Plough + Trailer)"
  });

  await setComposedBundleComponents(db, actor, skuBundle.id, [
    { componentSkuId: skuRubber.id, quantity: 1 },
    { componentSkuId: skuPlough.id, quantity: 1 },
    { componentSkuId: skuTrailer.id, quantity: 1 }
  ]);

  // 8. Factory Kit SKU: AGT-000189 (is_kit = true, §5.2)
  await createSkuDraft(db, actor, {
    internalSku: "AGT-000189",
    productTypeId: motoblockType.id,
    lifecycleState: "IDENTIFIED",
    identityConfidence: "HIGH",
    isKit: true,
    kitComponentsJson: [
      { nameKa: "ძირითადი აგრეგატი WEIMA WM1100C-6", nameEn: "Main unit WEIMA WM1100C-6", quantity: 1 },
      { nameKa: "სტანდარტული ფრეზების წყვილი (24 დანა)", nameEn: "Standard rotary blades (24 pcs)", quantity: 1 },
      { nameKa: "ქარხნული ინსტრუმენტების ჩანთა", nameEn: "Factory tool kit", quantity: 1 }
    ],
    brand: "WEIMA",
    modelCode: "WM1100C-6-KIT",
    keyDifferentiatorKa: "7 ცხ.ძ. ბენზინი, ქარხნული კომპლექტი",
    keyDifferentiatorEn: "7 HP Gasoline, Factory Kit",
    universalUnits: {
      power: "7 HP",
      engineDisplacement: "212 cc",
      weight: "98 kg"
    },
    typeAttributes: {
      fuel_type: { value: "GASOLINE", status: "VERIFIED" },
      engine_model: { value: "WM170F-2", status: "VERIFIED" },
      wheel_type: { value: "RUBBER", status: "VERIFIED" }
    }
  });

  // 9. Sample Legacy SEO URL (§12.5)
  await registerLegacyUrl(db, actor, {
    oldHost: "agro-trade.ge",
    oldPathRaw: "/product/%E1%83%9B%E1%83%9D%E1%83%A2%E1%83%9D%E1%83%91%E1%83%9A%E1%83%9D%E1%83%99%E1%83%98-hiromiki-d178e/",
    entityType: "PRODUCT",
    entityId: skuRubber.id,
    decision: "KEEP_301",
    gscClicks16m: 1420,
    gscImpressions16m: 28900,
    backlinks: 14,
    notes: "High-traffic legacy product URL mapped to canonical SKU AGT-000184"
  });

  return {
    skipped: false,
    ...taxonomyStats,
    seededSkus: [
      skuRubber.internalSku,
      skuIron.internalSku,
      skuPlough.internalSku,
      skuTrailer.internalSku,
      skuBundle.internalSku,
      "AGT-000189"
    ]
  };
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("seed-products.ts")
) {
  runProductsSeed()
    .then(async (res) => {
      console.log("Products seed completed:", res);
      await closeAppPool();
    })
    .catch(async (err) => {
      console.error("Products seed failed:", err);
      await closeAppPool();
      process.exit(1);
    });
}

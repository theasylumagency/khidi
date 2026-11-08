import { eq } from "drizzle-orm";
import { reviewSkuEvidence, setSkuIdentityKind, submitSkuEvidence } from "@khidi/evidence";
import {
  closeAppPool,
  assertSeedDatabaseSafety,
  getDb,
  legalEntities,
  skus,
  storefronts,
  users
} from "@khidi/db";
import {
  attachSkuIdentifier,
  approveCanonicalVersion,
  createProductFamily,
  createSkuDraft,
  registerLegacyUrl,
  saveCanonicalVersion,
  seedTaxonomyAndProductTypes,
  setComposedBundleComponents,
  setStorefrontListing,
  transitionSkuLifecycle,
  transitionSkuToReady,
  upsertAccountingMapping
} from "./index.ts";

export async function runProductsSeed() {
  assertSeedDatabaseSafety();
  const db = getDb();

  // 1. Always ensure 9 categories (8 public + UNCLASSIFIED) and 30 initial Product Types exist
  const taxonomyStats = await seedTaxonomyAndProductTypes(db);

  // 2. Check if initial seed SKU KH-000001 already exists
  const [existingSku] = await db
    .select()
    .from(skus)
    .where(eq(skus.internalSku, "KH-000001"))
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
    .where(eq(storefronts.key, "store-a"))
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

  // 4. Variant 1: KH-000001 — 9 HP Diesel Motoblock with Rubber Wheels -> READY ([C8])
  const skuRubber = await createSkuDraft(db, actor, {
    productFamilyId: hiromikiFamily.id,
    productTypeId: motoblockType.id,
    brand: "HIROMIKI",
    manufacturer: "HIROMIKI Power Equipment",
    modelCode: "D178E-DF900Q",
    keyDifferentiatorKa: "9 ცხ.ძ., რეზინის ბორბლებით",
    keyDifferentiatorEn: "9 HP, Rubber Wheels",
    universalUnits: {
      power: { value: "9 HP", status: "VERIFIED", sourceType: "PLATE", verifiedBy: adminUser.id }, // -> 6.62 kW (§5.6)
      engineDisplacement: { value: "418 cc", status: "VERIFIED", sourceType: "SPEC_SHEET", verifiedBy: adminUser.id },
      workingWidth: { value: "110 cm", status: "VERIFIED", sourceType: "SPEC_SHEET", verifiedBy: adminUser.id },
      workingDepth: { value: "30 cm", status: "VERIFIED", sourceType: "SPEC_SHEET", verifiedBy: adminUser.id },
      weight: { value: "135 kg", status: "VERIFIED", sourceType: "PLATE", verifiedBy: adminUser.id }
    },
    typeAttributes: {
      fuel_type: { value: "DIESEL", status: "VERIFIED", sourceType: "PLATE", verifiedBy: adminUser.id },
      engine_model: { value: "186FA", status: "VERIFIED", sourceType: "PLATE", verifiedBy: adminUser.id },
      start_type: { value: "ELECTRIC_STARTER", status: "VERIFIED", sourceType: "SPEC_SHEET", verifiedBy: adminUser.id },
      transmission_gears: { value: "2 წინ + 1 უკან", status: "VERIFIED", sourceType: "SPEC_SHEET", verifiedBy: adminUser.id },
      wheel_size: { value: "4.00-10", status: "VERIFIED", sourceType: "PHOTO", verifiedBy: adminUser.id },
      wheel_type: { value: "RUBBER", status: "VERIFIED", sourceType: "PHOTO", verifiedBy: adminUser.id },
      pto_shaft: { value: true, status: "VERIFIED", sourceType: "SPEC_SHEET", verifiedBy: adminUser.id }
    },
    shortDescriptionKa: "9 ცხ.ძ. დიზელის მოტობლოკი ელექტრო სტარტერით, 4.00-10 რეზინის ბორბლებით და 32 დანიანი ფრეზით.",
    shortDescriptionEn: "9 HP diesel motoblock with electric starter, 4.00-10 rubber wheels, and 32-blade rotary tiller."
  });

  await attachSkuIdentifier(db, actor, {
    skuId: skuRubber.id,
    identifierType: "GTIN",
    value: "4860000010012",
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

  // Walk KH-000001 through explicit lifecycle transitions (§15.1) before transitioning to READY ([C8])
  await transitionSkuLifecycle(db, actor, skuRubber.id, "IDENTIFYING");
  const claims = { brand: "HIROMIKI", model_code: "D178E-DF900Q", fuel_type: "DIESEL",
    power_kw: 6.62, transmission_gears: "2 წინ + 1 უკან", wheel_type: "RUBBER" };
  const fixtureEvidence = await submitSkuEvidence(db, actor, {
    skuId: skuRubber.id, type: "FACTORY_SPEC_SHEET", notes: "Synthetic development fixture", claims
  });
  await reviewSkuEvidence(db, actor, {
    evidenceId: fixtureEvidence.id, status: "ACCEPTED", reason: "Verified synthetic fixture", claims
  });
  await setSkuIdentityKind(db, actor, skuRubber.id, "MANUFACTURER_IDENTIFIED", "Verified synthetic fixture");
  await transitionSkuLifecycle(db, actor, skuRubber.id, "IDENTIFIED", {
    reason: "Plate and packaging verified"
  });
  await transitionSkuLifecycle(db, actor, skuRubber.id, "ACCOUNTING_MAPPING_REQUIRED");
  await transitionSkuLifecycle(db, actor, skuRubber.id, "CONTENT_GENERATING");
  await transitionSkuLifecycle(db, actor, skuRubber.id, "CONTENT_REVIEW");

  // Transition KH-000001 to READY — assigns canonical_slug = 'hiromiki-d178e-df900q-9-hp-rubber-wheels' ([C8])
  for (const locale of ["ka", "en"]) {
    const { version } = await saveCanonicalVersion(db, actor, { skuId: skuRubber.id, locale });
    await approveCanonicalVersion(db, actor, { skuId: skuRubber.id, versionId: version.id });
  }
  await transitionSkuToReady(db, actor, skuRubber.id);

  // Enable Storefront Listing on store-a (§4.5)
  await setStorefrontListing(db, actor, {
    storefrontId: agroStorefront.id,
    skuId: skuRubber.id,
    enabled: true,
    reason: "Initial READY catalog item on AgroTrade storefront"
  });

  // 5. Variant 2: KH-000002 — 9 HP Diesel Motoblock with Iron Wheels (§5.1 separate SKU, in INTAKE with NULL slug [C8])
  const skuIron = await createSkuDraft(db, actor, {
    productFamilyId: hiromikiFamily.id,
    productTypeId: motoblockType.id,
    brand: "HIROMIKI",
    modelCode: "D178E-DF900Q",
    keyDifferentiatorKa: "9 ცხ.ძ., რკინის ბორბლებით",
    keyDifferentiatorEn: "9 HP, Iron Wheels",
    universalUnits: {
      power: "9 HP",
      workingWidth: "110 cm",
      weight: "142 kg"
    },
    typeAttributes: {
      fuel_type: { value: "DIESEL", status: "VERIFIED", verifiedBy: adminUser.id },
      engine_model: { value: "186FA", status: "UNVERIFIED" },
      wheel_type: { value: "IRON", status: "VERIFIED", verifiedBy: adminUser.id }
    }
  });

  // 6. Component SKUs for Composed Bundle: Plough (KH-000003) & Trailer (KH-000004)
  const skuPlough = await createSkuDraft(db, actor, {
    productTypeId: attachmentType.id,
    brand: "WEIMA",
    modelCode: "WM-PL01",
    keyDifferentiatorKa: "ერთფრთიანი გუთანი",
    keyDifferentiatorEn: "Single Furrow Plough",
    universalUnits: {
      workingDepth: "22 cm",
      weight: "18 kg"
    },
    typeAttributes: {
      attachment_kind: { value: "PLOUGH", status: "VERIFIED", verifiedBy: adminUser.id },
      compatible_mount: { value: "HIROMIKI / WEIMA 178-186 სერია", status: "VERIFIED", verifiedBy: adminUser.id }
    }
  });
  await transitionSkuLifecycle(db, actor, skuPlough.id, "IDENTIFYING");
  await transitionSkuLifecycle(db, actor, skuPlough.id, "IDENTIFIED");

  const skuTrailer = await createSkuDraft(db, actor, {
    productTypeId: trailerType.id,
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
      payload_capacity_kg: { value: 500, status: "VERIFIED", verifiedBy: adminUser.id },
      brake_type: { value: "MECHANICAL_DRUM", status: "VERIFIED", verifiedBy: adminUser.id },
      dumping_bed: { value: true, status: "VERIFIED", verifiedBy: adminUser.id }
    }
  });
  await transitionSkuLifecycle(db, actor, skuTrailer.id, "IDENTIFYING");
  await transitionSkuLifecycle(db, actor, skuTrailer.id, "IDENTIFIED");

  // 7. Composed Bundle SKU: KH-000005 (Motoblock × 1 + Plough × 1 + Trailer × 1, §5.2)
  const skuBundle = await createSkuDraft(db, actor, {
    productTypeId: motoblockType.id,
    isComposedBundle: true,
    brand: "HIROMIKI",
    modelCode: "D178E-AGRO-SET",
    keyDifferentiatorKa: "სრული კომპლექტი (მოტობლოკი + გუთანი + მისაბმელი)",
    keyDifferentiatorEn: "Full Bundle (Motoblock + Plough + Trailer)"
  });
  await transitionSkuLifecycle(db, actor, skuBundle.id, "IDENTIFYING");
  await transitionSkuLifecycle(db, actor, skuBundle.id, "IDENTIFIED");

  await setComposedBundleComponents(db, actor, skuBundle.id, [
    { componentSkuId: skuRubber.id, quantity: 1 },
    { componentSkuId: skuPlough.id, quantity: 1 },
    { componentSkuId: skuTrailer.id, quantity: 1 }
  ]);

  // 8. Factory Kit SKU: KH-000006 (is_kit = true, §5.2)
  const skuKit = await createSkuDraft(db, actor, {
    productTypeId: motoblockType.id,
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
      fuel_type: { value: "GASOLINE", status: "VERIFIED", verifiedBy: adminUser.id },
      engine_model: { value: "WM170F-2", status: "VERIFIED", verifiedBy: adminUser.id },
      wheel_type: { value: "RUBBER", status: "VERIFIED", verifiedBy: adminUser.id }
    }
  });
  await transitionSkuLifecycle(db, actor, skuKit.id, "IDENTIFYING");
  await transitionSkuLifecycle(db, actor, skuKit.id, "IDENTIFIED");

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
    notes: "High-traffic legacy product URL mapped to canonical SKU KH-000001"
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
      skuKit.internalSku
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
      console.error("SAFETY: Khidi product seed failed; verify the dedicated development/test database configuration.");
      await closeAppPool();
      process.exit(1);
    });
}

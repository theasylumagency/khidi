import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  getDb,
  legalEntities,
  outboxEvents,
  skuSlugHistory,
  skus,
  storefronts,
  users
} from "@khidi/db";
import { AppError, createUuidV7 } from "@khidi/shared";
import {
  attachSkuIdentifier,
  buildThermalLabelSpec,
  createProductFamily,
  createSkuDraft,
  generateDeterministicDisplayNames,
  getBundleComponents,
  getProductTypeByKey,
  listAccountingMappingsForSku,
  listCategories,
  listProductTypes,
  listSkuSlugHistory,
  normalizeLegacyUrlPath,
  normalizePowerToKw,
  registerLegacyUrl,
  resolveSkuByScannedIdentifier,
  seedTaxonomyAndProductTypes,
  setComposedBundleComponents,
  setStorefrontListing,
  transitionSkuToReady,
  updateSkuCanonicalSlug,
  upsertAccountingMapping,
  upsertProductType,
  validateTypeAttributesAgainstSchema
} from "./index.ts";

describe("@khidi/products — Milestone 2: Product Master, Taxonomy, [C7, C8, C9], Bundles & Labels", () => {
  const db = getDb();
  let adminUserId: string;
  let agroEntityId: string;
  let newBrandEntityId: string;
  let agroStorefrontId: string;

  beforeAll(async () => {
    await seedTaxonomyAndProductTypes(db);

    const [admin] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
    const [agro] = await db
      .select()
      .from(legalEntities)
      .where(eq(legalEntities.key, "AGROTRADE"))
      .limit(1);
    const [newBrand] = await db
      .select()
      .from(legalEntities)
      .where(eq(legalEntities.key, "NEWBRAND"))
      .limit(1);
    const [sf] = await db
      .select()
      .from(storefronts)
      .where(eq(storefronts.key, "agrotrade-ge"))
      .limit(1);

    adminUserId = admin!.id;
    agroEntityId = agro!.id;
    newBrandEntityId = newBrand!.id;
    agroStorefrontId = sf!.id;
  });

  it("seeds 8 public top-level categories + 1 internal UNCLASSIFIED category and 30 initial Product Types (§5.7, §5.8)", async () => {
    const cats = await listCategories(db);
    const publicCats = cats.filter((c) => !c.isUnclassified);
    const unclassifiedCats = cats.filter((c) => c.isUnclassified);

    expect(publicCats).toHaveLength(8);
    expect(unclassifiedCats).toHaveLength(1);
    expect(unclassifiedCats[0]?.key).toBe("UNCLASSIFIED");
    // No public Miscellaneous / სხვადასხვა category (§5.7)
    expect(publicCats.some((c) => c.nameKa.includes("სხვადასხვა"))).toBe(false);

    const types = await listProductTypes(db);
    expect(types.length).toBeGreaterThanOrEqual(30);

    const motoblock = await getProductTypeByKey(db, "MOTOBLOCK");
    expect(motoblock.nameKa).toBe("მოტობლოკი");
    expect(motoblock.searchAliasesKa).toContain("კულტივატორი");
    expect(motoblock.photoInstructionsJson).toHaveLength(3);
    expect(motoblock.aiResearchContractJson.forbidInvention).toBe(true);
    expect(motoblock.aiResearchContractJson.unknownFieldPolicy).toBe("NULL_NOT_FOUND");
  });

  it("supports adding a new Product Type dynamically without DB redesign and validates hybrid attributes (§5.8, §5.9)", async () => {
    const cats = await listCategories(db);
    const agriCat = cats.find((c) => c.key === "AGRI_MACHINERY")!;

    const customType = await upsertProductType(
      db,
      { userId: adminUserId },
      {
        key: "HAY_BALER",
        defaultCategoryId: agriCat.id,
        nameKa: "თივის საპრესი",
        nameEn: "Hay Baler",
        attributeSchemaJson: [
          {
            key: "bale_shape",
            labelKa: "ტუკის ფორმა",
            labelEn: "Bale Shape",
            dataType: "enum",
            tier: "REQUIRED_IDENTITY",
            filterCandidate: true,
            enumValues: ["ROUND", "SQUARE"]
          },
          {
            key: "bale_weight_kg",
            labelKa: "ტუკის წონა (კგ)",
            labelEn: "Bale Weight (kg)",
            dataType: "number",
            tier: "IMPORTANT_SPEC",
            filterCandidate: true,
            unit: "kg"
          }
        ],
        photoInstructionsJson: [
          {
            slot: "MAIN",
            titleKa: "მთავარი ხედი",
            titleEn: "Main View",
            guidanceKa: "წინა 3/4 ხედი",
            guidanceEn: "Front 3/4 view",
            required: true
          }
        ]
      }
    );

    expect(customType.key).toBe("HAY_BALER");

    // Valid attributes pass
    const valid = validateTypeAttributesAgainstSchema(customType.attributeSchemaJson, {
      bale_shape: { value: "ROUND", status: "VERIFIED" },
      bale_weight_kg: { value: null, status: "NOT_FOUND" }
    });
    expect(valid.bale_shape?.value).toBe("ROUND");

    // Unknown un-schematized attribute key is rejected (§5.9 no uncontrolled JSON blobs)
    expect(() =>
      validateTypeAttributesAgainstSchema(customType.attributeSchemaJson, {
        random_unschematized_field: { value: "bad", status: "UNVERIFIED" }
      })
    ).toThrow(AppError);

    // Invalid enum value is rejected
    expect(() =>
      validateTypeAttributesAgainstSchema(customType.attributeSchemaJson, {
        bale_shape: { value: "TRIANGLE", status: "VERIFIED" }
      })
    ).toThrow(AppError);
  });

  it("normalizes universal units ('9 HP' -> 6.62 kW) and generates deterministic KA/EN names without invention (§5.6, §5.10)", () => {
    expect(normalizePowerToKw("9 HP")).toEqual({
      valueKw: 6.62,
      sourceString: "9 HP"
    });
    expect(normalizePowerToKw("9 ცხ.ძ.")).toEqual({
      valueKw: 6.62,
      sourceString: "9 ცხ.ძ."
    });

    const withDiff = generateDeterministicDisplayNames({
      brand: "HIROMIKI",
      modelCode: "D178E-DF900Q",
      productTypeNameKa: "მოტობლოკი",
      productTypeNameEn: "Motoblock",
      keyDifferentiatorKa: "9 ცხ.ძ.",
      keyDifferentiatorEn: "9 HP"
    });
    expect(withDiff.displayNameKa).toBe("HIROMIKI D178E-DF900Q — მოტობლოკი, 9 ცხ.ძ.");
    expect(withDiff.displayNameEn).toBe("HIROMIKI D178E-DF900Q — Motoblock, 9 HP");

    // Unknown differentiator -> omit it cleanly (§5.10)
    const withoutDiff = generateDeterministicDisplayNames({
      brand: "HIROMIKI",
      modelCode: "D178E-DF900Q",
      productTypeNameKa: "მოტობლოკი",
      productTypeNameEn: "Motoblock",
      keyDifferentiatorKa: null,
      keyDifferentiatorEn: ""
    });
    expect(withoutDiff.displayNameKa).toBe("HIROMIKI D178E-DF900Q — მოტობლოკი");
    expect(withoutDiff.displayNameEn).toBe("HIROMIKI D178E-DF900Q — Motoblock");
  });

  it("enforces [C8] nullable canonical_slug in INTAKE, generates slug at READY, and enforces [C7] append-only sku_slug_history", async () => {
    const motoblock = await getProductTypeByKey(db, "MOTOBLOCK");
    const uniqueModel = `D178E-${createUuidV7().slice(-8).toUpperCase()}`;

    // 1. Create SKU in INTAKE -> canonical_slug MUST be NULL ([C8])
    const draft = await createSkuDraft(
      db,
      { userId: adminUserId },
      {
        productTypeId: motoblock.id,
        brand: "HIROMIKI",
        modelCode: uniqueModel,
        keyDifferentiatorKa: "9 ცხ.ძ.",
        keyDifferentiatorEn: "9 HP",
        universalUnits: {
          power: "9 HP",
          workingWidth: "90 cm",
          weight: "115 kg"
        }
      }
    );

    expect(draft.lifecycleState).toBe("INTAKE");
    expect(draft.canonicalSlug).toBeNull();
    expect(draft.internalSku).toMatch(/^AGT-\d{6,}$/);
    expect(draft.powerKw).toBe("6.620");
    expect(draft.workingWidthMm).toBe("900.00");
    expect(draft.unitSourceStringsJson.power_kw).toBe("9 HP");

    // 2. Direct DB attempt to set lifecycle_state = 'READY' with canonical_slug = NULL must fail CHECK constraint ([C8])
    await expect(
      db
        .update(skus)
        .set({ lifecycleState: "READY", canonicalSlug: null })
        .where(eq(skus.id, draft.id))
    ).rejects.toThrow();

    // 3. Transition to READY via domain service -> generates canonical_slug ([C8])
    const readySku = await transitionSkuToReady(db, { userId: adminUserId }, draft.id);
    const expectedInitialSlug = `hiromiki-${uniqueModel.toLowerCase()}`;
    expect(readySku.lifecycleState).toBe("READY");
    expect(readySku.canonicalSlug).toBe(expectedInitialSlug);
    expect(readySku.displayNameKa).toBe(`HIROMIKI ${uniqueModel} — მოტობლოკი, 9 ცხ.ძ.`);

    // 4. Change canonical_slug -> old slug is preserved in sku_slug_history ([C7, C8])
    const updatedSlugValue = `${expectedInitialSlug}-v2`;
    const renamedSku = await updateSkuCanonicalSlug(
      db,
      { userId: adminUserId },
      draft.id,
      updatedSlugValue,
      "Model code refinement"
    );
    expect(renamedSku.canonicalSlug).toBe(updatedSlugValue);

    const history = await listSkuSlugHistory(db, draft.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.oldSlug).toBe(expectedInitialSlug);

    // 5. [C7] Append-only immutability on sku_slug_history: UPDATE and DELETE are blocked for hub_app!
    await expect(
      db
        .update(skuSlugHistory)
        .set({ oldSlug: "tampered-slug" })
        .where(eq(skuSlugHistory.id, history[0]!.id))
    ).rejects.toThrow();

    await expect(
      db.delete(skuSlugHistory).where(eq(skuSlugHistory.id, history[0]!.id))
    ).rejects.toThrow();
  });

  it("detects barcode/identifier collisions across SKUs without silent merging (§5.3) and supports multi-entity accounting_mappings with legal_entity_id ([C9], §5.5)", async () => {
    const motoblock = await getProductTypeByKey(db, "MOTOBLOCK");
    const family = await createProductFamily(
      db,
      { userId: adminUserId },
      {
        code: `FAM-${createUuidV7().slice(-8).toUpperCase()}`,
        productTypeId: motoblock.id,
        brand: "WEIMA",
        baseModel: "WM1100",
        titleKa: "WEIMA WM1100 სერია"
      }
    );

    const skuA = await createSkuDraft(
      db,
      { userId: adminUserId },
      {
        productFamilyId: family.id,
        productTypeId: motoblock.id,
        brand: "WEIMA",
        modelCode: "WM1100-RUBBER",
        keyDifferentiatorKa: "რეზინის ბორბლებით"
      }
    );

    const skuB = await createSkuDraft(
      db,
      { userId: adminUserId },
      {
        productFamilyId: family.id,
        productTypeId: motoblock.id,
        brand: "WEIMA",
        modelCode: "WM1100-IRON",
        keyDifferentiatorKa: "რკინის ბორბლებით"
      }
    );

    const sharedBarcode = `486999${Date.now().toString().slice(-6)}`;

    const attach1 = await attachSkuIdentifier(
      db,
      { userId: adminUserId },
      {
        skuId: skuA.id,
        identifierType: "GTIN",
        value: sharedBarcode,
        verified: true
      }
    );
    expect(attach1.collisionDetected).toBe(false);

    // Attach the same GTIN to skuB -> must flag collision on both, never merge!
    const attach2 = await attachSkuIdentifier(
      db,
      { userId: adminUserId },
      {
        skuId: skuB.id,
        identifierType: "GTIN",
        value: sharedBarcode,
        verified: false
      }
    );
    expect(attach2.collisionDetected).toBe(true);
    expect(attach2.conflictingSkuIds).toContain(skuA.id);

    const lookup = await resolveSkuByScannedIdentifier(db, sharedBarcode);
    expect(lookup.isAmbiguousCollision).toBe(true);
    expect(lookup.uniqueSkuIds.sort()).toEqual([skuA.id, skuB.id].sort());
    expect(lookup.matches.every((m) => m.hasCollision)).toBe(true);

    // [C9] Multi-entity accounting mappings using legal_entity_id, preserving exact string & name
    const mapAgro = await upsertAccountingMapping(
      db,
      { userId: adminUserId },
      {
        skuId: skuA.id,
        legalEntityId: agroEntityId,
        accountingItemId: "1610/00004/0099",
        accountingName: "  მოტობლოკი WEIMA WM1100 (ზუსტი ბუღალტრული სახელი)  "
      }
    );
    const mapNewBrand = await upsertAccountingMapping(
      db,
      { userId: adminUserId },
      {
        skuId: skuA.id,
        legalEntityId: newBrandEntityId,
        accountingItemId: "NB-WM-1100-99",
        accountingName: "WEIMA WM1100 Motoblock"
      }
    );

    expect(mapAgro.legalEntityId).toBe(agroEntityId);
    expect(mapAgro.accountingItemId).toBe("1610/00004/0099");
    // Exact preservation of accounting_name (§5.5)
    expect(mapAgro.accountingName).toBe("  მოტობლოკი WEIMA WM1100 (ზუსტი ბუღალტრული სახელი)  ");
    expect(mapNewBrand.legalEntityId).toBe(newBrandEntityId);

    const activeMappings = await listAccountingMappingsForSku(db, skuA.id, { activeOnly: true });
    expect(activeMappings).toHaveLength(2);
  });

  it("supports Composed Bundles (§5.2), Storefront Listings with LISTING_CHANGED outbox (§4.5), Legacy URLs (§12.5), and 58×40mm Thermal Labels (§5.4)", async () => {
    const motoblock = await getProductTypeByKey(db, "MOTOBLOCK");
    const attachment = await getProductTypeByKey(db, "AGRI_ATTACHMENT");

    const comp1 = await createSkuDraft(
      db,
      { userId: adminUserId },
      { productTypeId: motoblock.id, brand: "BUFFALO", modelCode: "BF-100" }
    );
    const comp2 = await createSkuDraft(
      db,
      { userId: adminUserId },
      { productTypeId: attachment.id, brand: "BUFFALO", modelCode: "BF-PLOUGH" }
    );
    const bundle = await createSkuDraft(
      db,
      { userId: adminUserId },
      {
        productTypeId: motoblock.id,
        isComposedBundle: true,
        brand: "BUFFALO",
        modelCode: "BF-100-BUNDLE"
      }
    );

    await setComposedBundleComponents(db, { userId: adminUserId }, bundle.id, [
      { componentSkuId: comp1.id, quantity: 1 },
      { componentSkuId: comp2.id, quantity: 1 }
    ]);

    const savedComponents = await getBundleComponents(db, bundle.id);
    expect(savedComponents).toHaveLength(2);

    // Self-reference or nested bundle is forbidden
    await expect(
      setComposedBundleComponents(db, { userId: adminUserId }, bundle.id, [
        { componentSkuId: bundle.id, quantity: 1 }
      ])
    ).rejects.toThrow(AppError);

    // Storefront listing emits LISTING_CHANGED to outbox (§4.5)
    const listing = await setStorefrontListing(
      db,
      { userId: adminUserId },
      {
        storefrontId: agroStorefrontId,
        skuId: comp1.id,
        enabled: true,
        reason: "Enable on AgroTrade"
      }
    );
    expect(listing.enabled).toBe(true);

    const listingEvents = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, listing.id));
    expect(listingEvents).toHaveLength(1);
    expect(listingEvents[0]?.eventType).toBe("LISTING_CHANGED");

    // Legacy URL normalization handles percent-encoded Georgian paths and forbids KEEP_301 without entityId (§12.5)
    const normalizedPath = normalizeLegacyUrlPath(
      "https://agro-trade.ge/Catalog/%E1%83%9B%E1%83%9D%E1%83%A2%E1%83%9D%E1%83%91%E1%83%9A%E1%83%9D%E1%83%99%E1%83%98/"
    );
    expect(normalizedPath).toBe("/catalog/მოტობლოკი");

    await expect(
      registerLegacyUrl(
        db,
        { userId: adminUserId },
        {
          oldHost: "agro-trade.ge",
          oldPathRaw: "/old-orphan-url",
          entityType: "PRODUCT",
          decision: "KEEP_301",
          entityId: null
        }
      )
    ).rejects.toThrow(/KEEP_301 decision requires an exact target entityId/);

    // Thermal label generator produces 58x40mm printable HTML + Code128 + QR (§5.4)
    const label = buildThermalLabelSpec({
      internalSku: comp1.internalSku,
      qrValue: `khidi://sku/${comp1.internalSku}`,
      titleKa: "BUFFALO BF-100 — მოტობლოკი"
    });
    expect(label.widthMm).toBe(58);
    expect(label.heightMm).toBe(40);
    expect(label.code128Svg).toContain("<svg");
    expect(label.qrSvg).toContain(`data-qr-payload="khidi://sku/${comp1.internalSku}"`);
    expect(label.printableHtml).toContain("size: 58mm 40mm;");
  });
});

import { decideSkuEvidenceField, reviewSkuEvidence, setSkuIdentityKind, submitSkuEvidence } from "@khidi/evidence";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  accountingMappings,
  auditLogs,
  getDb,
  legalEntities,
  outboxEvents,
  productFamilies,
  skuIdentifiers,
  skuSlugHistory,
  skus,
  storefronts,
  users
} from "@khidi/db";
import { AppError, createUuidV7 } from "@khidi/shared";
import {
  attachSkuIdentifier,
  approveCanonicalVersion,
  buildThermalLabelSpec,
  computeGs1CheckDigit,
  createProductFamily,
  createSkuDraft,
  generateDeterministicDisplayNames,
  getBundleComponents,
  getProductTypeByKey,
  listAccountingMappingsForSku,
  listCategories,
  listProductTypes,
  listSkuSlugHistory,
  normalizeAndValidateGtin14,
  normalizeLegacyUrlPath,
  normalizePowerToKw,
  normalizeUniversalUnits,
  registerLegacyUrl,
  saveCanonicalVersion,
  removeSkuIdentifier,
  resolveSkuByScannedIdentifier,
  seedTaxonomyAndProductTypes,
  setComposedBundleComponents,
  setStorefrontListing,
  transitionSkuLifecycle,
  transitionSkuToReady,
  updateSkuCanonicalSlug,
  upsertAccountingMapping,
  upsertProductType,
  validateTypeAttributesAgainstSchema
} from "./index.ts";

describe("@khidi/products — Milestone 2: Product Master, Taxonomy, [C7, C8, C9], Bundles & Labels", () => {
  const db = getDb();
  let adminUserId: string;
  let operatorUserId: string;
  let agroEntityId: string;
  let newBrandEntityId: string;
  let agroStorefrontId: string;

  beforeAll(async () => {
    await seedTaxonomyAndProductTypes(db);

    const [admin] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
    const [operator] = await db.select().from(users).where(eq(users.role, "OPERATOR")).limit(1);
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
    operatorUserId = operator!.id;
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

  it("supports adding a new Product Type dynamically and enforces VERIFIED provenance on both type attributes and universal units (§5.6, §5.8, §5.9)", async () => {
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

    // Marking a type attribute VERIFIED without evidenceId or verifiedBy is rejected (§5.9)
    expect(() =>
      validateTypeAttributesAgainstSchema(customType.attributeSchemaJson, {
        bale_shape: { value: "ROUND", status: "VERIFIED" }
      })
    ).toThrow(/evidenceId or verifiedBy/);

    // Marking a universal unit VERIFIED without evidenceId or verifiedBy is rejected (§5.6, §5.9)
    expect(() =>
      normalizeUniversalUnits({
        power: { value: "9 HP", status: "VERIFIED", sourceType: "PLATE" }
      })
    ).toThrow(/evidenceId or verifiedBy/);

    // Plain unit string defaults to UNVERIFIED in unitMetadataJson; structured VERIFIED unit with verifiedBy succeeds
    const normUnits = normalizeUniversalUnits({
      power: { value: "9 HP", status: "VERIFIED", sourceType: "PLATE", verifiedBy: adminUserId },
      weight: "135 kg"
    });
    expect(normUnits.powerKw).toBe("6.62");
    expect(normUnits.unitMetadataJson.power_kw?.status).toBe("VERIFIED");
    expect(normUnits.unitMetadataJson.power_kw?.verifiedBy).toBe(adminUserId);
    expect(normUnits.unitMetadataJson.weight_kg?.status).toBe("UNVERIFIED");

    // Valid attributes with verifiedBy pass
    const valid = validateTypeAttributesAgainstSchema(customType.attributeSchemaJson, {
      bale_shape: { value: "ROUND", status: "VERIFIED", verifiedBy: adminUserId },
      bale_weight_kg: { value: null, status: "NOT_FOUND" }
    });
    expect(valid.bale_shape?.value).toBe("ROUND");
    expect(valid.bale_shape?.verifiedBy).toBe(adminUserId);

    // Unknown un-schematized attribute key is rejected (§5.9 no uncontrolled JSON blobs)
    expect(() =>
      validateTypeAttributesAgainstSchema(customType.attributeSchemaJson, {
        random_unschematized_field: { value: "bad", status: "UNVERIFIED" }
      })
    ).toThrow(AppError);

    // Invalid enum value is rejected
    expect(() =>
      validateTypeAttributesAgainstSchema(customType.attributeSchemaJson, {
        bale_shape: { value: "TRIANGLE", status: "VERIFIED", verifiedBy: adminUserId }
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

  it("enforces explicit SKU lifecycle state machine (§15.1), neutral KH- internal_sku, [C8] READY preconditions, and [C7] append-only sku_slug_history", async () => {
    const motoblock = await getProductTypeByKey(db, "MOTOBLOCK");
    const uniqueModel = `D178E-${createUuidV7().slice(-8).toUpperCase()}`;

    // 1. Create SKU in INTAKE -> always starts in INTAKE + LOW confidence, canonical_slug = NULL, neutral KH-XXXXXX code
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
    expect(draft.identityConfidence).toBe("LOW");
    expect(draft.canonicalSlug).toBeNull();
    expect(draft.internalSku).toMatch(/^KH-\d{6,}$/);
    expect(draft.powerKw).toBe("6.620");
    expect(draft.workingWidthMm).toBe("900.00");
    expect(draft.unitSourceStringsJson.power_kw).toBe("9 HP");
    expect(draft.unitMetadataJson.power_kw?.status).toBe("UNVERIFIED");

    // 2. Jumping directly from INTAKE to READY or INTAKE to CONTENT_REVIEW must fail (§15.1)
    await expect(
      transitionSkuToReady(db, { userId: adminUserId }, draft.id)
    ).rejects.toThrow(/must be in "CONTENT_REVIEW" first/);

    await expect(
      transitionSkuLifecycle(db, { userId: adminUserId }, draft.id, "CONTENT_REVIEW")
    ).rejects.toThrow(/Invalid SKU lifecycle transition/);

    // 3. Direct DB attempt to set lifecycle_state = 'READY' with canonical_slug = NULL or LOW confidence must fail CHECK constraint ([C8])
    await expect(
      db
        .update(skus)
        .set({ lifecycleState: "READY", canonicalSlug: null })
        .where(eq(skus.id, draft.id))
    ).rejects.toThrow();

    // 4. Walk state machine to CONTENT_REVIEW while still LOW confidence -> READY must fail due to LOW confidence & missing accounting_mapping
    await transitionSkuLifecycle(db, { userId: adminUserId }, draft.id, "IDENTIFYING");
    await transitionSkuLifecycle(db, { userId: adminUserId }, draft.id, "IDENTIFIED");
    await transitionSkuLifecycle(
      db,
      { userId: adminUserId },
      draft.id,
      "ACCOUNTING_MAPPING_REQUIRED"
    );
    await transitionSkuLifecycle(db, { userId: adminUserId }, draft.id, "CONTENT_GENERATING");
    await transitionSkuLifecycle(db, { userId: adminUserId }, draft.id, "CONTENT_REVIEW");

    await expect(
      transitionSkuToReady(db, { userId: adminUserId }, draft.id)
    ).rejects.toThrow(/identity_confidence="LOW"/);

    // 5. ADR-010: only accepted evidence plus an explicit field decision yields MEDIUM.
    const actor = { userId: adminUserId };
    const claims = { brand: "HIROMIKI", model_code: uniqueModel, power_kw: 6.62 };
    const carton = await submitSkuEvidence(db, actor, { skuId: draft.id, type: "PACKAGING_PHOTO", claims });
    await expect(reviewSkuEvidence(db, { userId: operatorUserId }, {
      evidenceId: carton.id, status: "ACCEPTED", reason: "Attempted operator acceptance", claims
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await reviewSkuEvidence(db, actor, { evidenceId: carton.id, status: "ACCEPTED", reason: "Confirmed carton reading", claims });
    for (const field of Object.keys(claims)) await decideSkuEvidenceField(db, actor, {
      skuId: draft.id, evidenceId: carton.id, field, reason: "Explicit carton field confirmation"
    });
    await setSkuIdentityKind(db, actor, draft.id, "MANUFACTURER_IDENTIFIED", "Both manufacturer fields verified");
    const confidenceAuditRows = await db.select().from(auditLogs).where(and(
      eq(auditLogs.entityId, draft.id), eq(auditLogs.action, "SKU_IDENTITY_RECOMPUTED")
    ));
    expect(confidenceAuditRows.at(-1)?.afterJson).toMatchObject({ level: "MEDIUM", ruleVersion: "identity-rule-v1" });

    await expect(
      transitionSkuToReady(db, { userId: adminUserId }, draft.id)
    ).rejects.toThrow(/humanConfirmedMediumConfidence: true/);

    await expect(
      transitionSkuToReady(db, { userId: adminUserId }, draft.id, {
        humanConfirmedMediumConfidence: true
      })
    ).rejects.toThrow(/requires at least one active accounting_mapping/);

    // 6. Add active accounting mapping -> transition to READY succeeds ([C8, C9])
    await upsertAccountingMapping(
      db,
      { userId: adminUserId },
      {
        skuId: draft.id,
        legalEntityId: agroEntityId,
        accountingItemId: `1610/${uniqueModel}`,
        accountingName: `HIROMIKI ${uniqueModel}`
      }
    );

    await expect(transitionSkuToReady(db, actor, draft.id, { humanConfirmedMediumConfidence: true }))
      .rejects.toThrow(/Approved KA canonical content is required/);
    const { version } = await saveCanonicalVersion(db, actor, { skuId: draft.id, locale: "ka" });
    await approveCanonicalVersion(db, actor, { skuId: draft.id, versionId: version.id });
    const readySku = await transitionSkuToReady(db, { userId: adminUserId }, draft.id, {
      humanConfirmedMediumConfidence: true
    });
    const expectedInitialSlug = `hiromiki-${uniqueModel.toLowerCase()}-9-hp`;
    expect(readySku.lifecycleState).toBe("READY");
    expect(readySku.canonicalSlug).toBe(expectedInitialSlug);
    expect(readySku.displayNameKa).toBe(`HIROMIKI ${uniqueModel} — მოტობლოკი, 9 ცხ.ძ.`);

    // 7. Change canonical_slug -> old slug is preserved in sku_slug_history ([C7, C8])
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

    // 8. [C7] Append-only immutability on sku_slug_history: UPDATE and DELETE are blocked for hub_app!
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

  it("generates deterministic variant slugs including differentiator regardless of approval order (§5.1, §5.11)", async () => {
    const motoblock = await getProductTypeByKey(db, "MOTOBLOCK");
    const suffix = createUuidV7().slice(-8).toUpperCase();
    const sharedModel = `DF900Q-${suffix}`;

    const family = await createProductFamily(
      db,
      { userId: adminUserId },
      {
        code: `FAM-VAR-${suffix}`,
        productTypeId: motoblock.id,
        brand: "HIROMIKI",
        baseModel: sharedModel,
        titleKa: `HIROMIKI ${sharedModel} ოჯახი`
      }
    );

    const ironSku = await createSkuDraft(
      db,
      { userId: adminUserId },
      {
        productFamilyId: family.id,
        productTypeId: motoblock.id,
        brand: "HIROMIKI",
        modelCode: sharedModel,
        keyDifferentiatorKa: "9 ცხ.ძ., რკინის ბორბლებით",
        keyDifferentiatorEn: "9 HP, Iron Wheels"
      }
    );

    const rubberSku = await createSkuDraft(
      db,
      { userId: adminUserId },
      {
        productFamilyId: family.id,
        productTypeId: motoblock.id,
        brand: "HIROMIKI",
        modelCode: sharedModel,
        keyDifferentiatorKa: "9 ცხ.ძ., რეზინის ბორბლებით",
        keyDifferentiatorEn: "9 HP, Rubber Wheels"
      }
    );

    for (const variant of [ironSku, rubberSku]) {
      await upsertAccountingMapping(
        db,
        { userId: adminUserId },
        {
          skuId: variant.id,
          legalEntityId: agroEntityId,
          accountingItemId: `1610/${variant.internalSku}`,
          accountingName: `HIROMIKI ${variant.internalSku}`
        }
      );
      await transitionSkuLifecycle(db, { userId: adminUserId }, variant.id, "IDENTIFYING");
      const actor = { userId: adminUserId };
      const claims = { brand: "HIROMIKI", model_code: sharedModel, ...(variant.id === ironSku.id ? { wheel_type: "IRON" } : {}) };
      const sheet = await submitSkuEvidence(db, actor, { skuId: variant.id, type: "FACTORY_SPEC_SHEET", claims });
      await reviewSkuEvidence(db, actor, { evidenceId: sheet.id, status: "ACCEPTED", reason: "Confirmed fixture specification", claims });
      await setSkuIdentityKind(db, actor, variant.id, "MANUFACTURER_IDENTIFIED", "Confirmed variant identity");
      await transitionSkuLifecycle(db, { userId: adminUserId }, variant.id, "IDENTIFIED");
      await transitionSkuLifecycle(
        db,
        { userId: adminUserId },
        variant.id,
        "ACCOUNTING_MAPPING_REQUIRED"
      );
      await transitionSkuLifecycle(db, { userId: adminUserId }, variant.id, "CONTENT_GENERATING");
      await transitionSkuLifecycle(db, { userId: adminUserId }, variant.id, "CONTENT_REVIEW");
    }

    const actor = { userId: adminUserId };
    const ironContent = await saveCanonicalVersion(db, actor, { skuId: ironSku.id, locale: "ka" });
    await approveCanonicalVersion(db, actor, { skuId: ironSku.id, versionId: ironContent.version.id });
    const readyIron = await transitionSkuToReady(db, actor, ironSku.id);
    const rubberClaims = { wheel_type: "RUBBER" };
    const wheelEvidence = await submitSkuEvidence(db, actor, { skuId: rubberSku.id, type: "ADMIN_PHYSICAL_INSPECTION",
      notes: "Observed the wheel material on the machine.", claims: rubberClaims });
    const [blocked] = await db.select().from(skus).where(eq(skus.id, rubberSku.id));
    expect(blocked?.identityConfidence).toBe("LOW");
    await expect(transitionSkuToReady(db, actor, rubberSku.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await reviewSkuEvidence(db, actor, { evidenceId: wheelEvidence.id, status: "ACCEPTED", reason: "Verified wheel material", claims: rubberClaims });
    const rubberContent = await saveCanonicalVersion(db, actor, { skuId: rubberSku.id, locale: "ka" });
    await approveCanonicalVersion(db, actor, { skuId: rubberSku.id, versionId: rubberContent.version.id });
    const readyRubber = await transitionSkuToReady(db, actor, rubberSku.id);
    expect(readyRubber.identityConfidence).toBe("HIGH");

    expect(readyIron.canonicalSlug).toBe(`hiromiki-${sharedModel.toLowerCase()}-9-hp-iron-wheels`);
    expect(readyRubber.canonicalSlug).toBe(
      `hiromiki-${sharedModel.toLowerCase()}-9-hp-rubber-wheels`
    );
  });

  it("validates GS1 check digits, normalizes UPC-A (12) and EAN-13 (13) to GTIN-14, serializes concurrent attachments via advisory lock, and clears collision flags on removal/archive (§5.3)", async () => {
    // 1. GS1 check digit validation & UPC-A <-> EAN-13 -> GTIN-14 equivalence
    // UPC-A "012345678905" == EAN-13 "0012345678905" == GTIN-14 "00012345678905"
    expect(normalizeAndValidateGtin14("012345678905")).toBe("00012345678905");
    expect(normalizeAndValidateGtin14("0012345678905")).toBe("00012345678905");
    expect(() => normalizeAndValidateGtin14("012345678909")).toThrow(/Invalid GS1 check digit/);

    // 2. Manual attachment of INTERNAL_SKU or INTERNAL_QR is forbidden
    const motoblock = await getProductTypeByKey(db, "MOTOBLOCK");
    const skuA = await createSkuDraft(
      db,
      { userId: adminUserId },
      {
        productTypeId: motoblock.id,
        brand: "WEIMA",
        modelCode: "WM1100-RUBBER",
        keyDifferentiatorEn: "Rubber Wheels"
      }
    );
    const skuB = await createSkuDraft(
      db,
      { userId: adminUserId },
      {
        productTypeId: motoblock.id,
        brand: "WEIMA",
        modelCode: "WM1100-IRON",
        keyDifferentiatorEn: "Iron Wheels"
      }
    );

    await expect(
      attachSkuIdentifier(
        db,
        { userId: adminUserId },
        {
          skuId: skuA.id,
          identifierType: "INTERNAL_SKU",
          value: "KH-999999"
        }
      )
    ).rejects.toThrow(/system-managed identifier and cannot be attached manually/);

    // DB partial unique index blocks duplicate INTERNAL_SKU even on raw SQL insert
    await expect(
      db.insert(skuIdentifiers).values({
        id: createUuidV7(),
        skuId: skuB.id,
        identifierType: "INTERNAL_SKU",
        value: skuA.internalSku,
        issuerSource: "INTERNAL",
        isPrimary: false,
        verified: true,
        hasCollision: false
      })
    ).rejects.toThrow();

    // 3. Concurrent attachments of the same barcode (one as 12-digit UPC, one as 13-digit EAN-13) serialize via pg_advisory_xact_lock and detect collision
    const rand6 = Math.floor(100000 + Math.random() * 899999).toString();
    const upcPayload11 = `04860${rand6}`; // 11 digits starting with 0
    const check = computeGs1CheckDigit(upcPayload11);
    const upc12 = `${upcPayload11}${check}`; // 12-digit UPC-A
    const ean13 = `0${upc12}`; // Equivalent 13-digit EAN-13

    const [resA, resB] = await Promise.all([
      attachSkuIdentifier(
        db,
        { userId: adminUserId },
        {
          skuId: skuA.id,
          identifierType: "UPC",
          value: upc12,
          verified: true
        }
      ),
      attachSkuIdentifier(
        db,
        { userId: adminUserId },
        {
          skuId: skuB.id,
          identifierType: "GTIN",
          value: ean13,
          verified: false
        }
      )
    ]);

    expect(resA.identifier.value).toBe(`00${upc12}`);
    expect(resB.identifier.value).toBe(`00${upc12}`);

    const lookupDuringCollision = await resolveSkuByScannedIdentifier(db, upc12);
    expect(lookupDuringCollision.isAmbiguousCollision).toBe(true);
    expect(lookupDuringCollision.uniqueSkuIds.sort()).toEqual([skuA.id, skuB.id].sort());
    expect(lookupDuringCollision.matches.every((m) => m.hasCollision)).toBe(true);

    // 4. Removing the identifier from skuB clears has_collision on skuA!
    await removeSkuIdentifier(db, { userId: adminUserId }, resB.identifier.id, "Wrong box scan");
    const lookupAfterRemoval = await resolveSkuByScannedIdentifier(db, ean13);
    expect(lookupAfterRemoval.isAmbiguousCollision).toBe(false);
    expect(lookupAfterRemoval.uniqueSkuIds).toEqual([skuA.id]);
    expect(lookupAfterRemoval.matches[0]?.hasCollision).toBe(false);

    // 5. Re-attach to skuB -> collision again -> then archive skuB -> clears collision on skuA and excludes archived skuB from scan lookup!
    await attachSkuIdentifier(
      db,
      { userId: adminUserId },
      {
        skuId: skuB.id,
        identifierType: "GTIN",
        value: ean13
      }
    );
    expect((await resolveSkuByScannedIdentifier(db, ean13)).isAmbiguousCollision).toBe(true);

    await transitionSkuLifecycle(db, { userId: adminUserId }, skuB.id, "ARCHIVED", {
      reason: "Duplicate draft archived"
    });

    // Archiving is terminal — transitioning out of ARCHIVED is forbidden
    await expect(
      transitionSkuLifecycle(db, { userId: adminUserId }, skuB.id, "INTAKE")
    ).rejects.toThrow(/Invalid SKU lifecycle transition from "ARCHIVED"/);

    const lookupAfterArchive = await resolveSkuByScannedIdentifier(db, ean13);
    expect(lookupAfterArchive.isAmbiguousCollision).toBe(false);
    expect(lookupAfterArchive.uniqueSkuIds).toEqual([skuA.id]);
    expect(lookupAfterArchive.matches[0]?.hasCollision).toBe(false);

    // 6. [C9] Multi-entity accounting mappings using legal_entity_id, preserving exact string & name
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
    expect(mapAgro.accountingName).toBe("  მოტობლოკი WEIMA WM1100 (ზუსტი ბუღალტრული სახელი)  ");
    expect(mapNewBrand.legalEntityId).toBe(newBrandEntityId);

    const activeMappings = await listAccountingMappingsForSku(db, skuA.id, { activeOnly: true });
    expect(activeMappings).toHaveLength(2);

    // 7. hub_app role cannot DELETE from skus, product_families, or accounting_mappings
    await expect(db.delete(skus).where(eq(skus.id, skuA.id))).rejects.toThrow();
    await expect(
      db.delete(accountingMappings).where(eq(accountingMappings.id, mapAgro.id))
    ).rejects.toThrow();
    await expect(db.delete(productFamilies)).rejects.toThrow();
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

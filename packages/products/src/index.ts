import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type AppDatabase,
  type DbExecutor,
  type KitComponentInfo,
  type ProductTypeAiResearchContract,
  type ProductTypeAttributeFieldDef,
  type ProductTypePhotoInstructionSlot,
  type SkuAttributeValueEntry,
  accountingMappings,
  bundleComponents,
  categories,
  legalEntities,
  legacyUrls,
  productFamilies,
  productTypes,
  skuIdentifiers,
  skuSlugHistory,
  skus,
  storefrontListings,
  storefronts
} from "@khidi/db";
import { type DomainActor, withDomainTransaction } from "@khidi/domain";
import { AppError, createUuidV7 } from "@khidi/shared";
import {
  INITIAL_CATEGORIES,
  INITIAL_PRODUCT_TYPES,
  validateTypeAttributesAgainstSchema
} from "./taxonomy.ts";
import { normalizeUniversalUnits, type UniversalUnitsInput } from "./units.ts";
import {
  generateCanonicalSlug,
  generateDeterministicDisplayNames,
  normalizeLegacyUrlPath
} from "./naming.ts";
import { buildThermalLabelSpec } from "./labels.ts";
import {
  buildCandidateLookupValues,
  normalizeIdentifierOnWrite
} from "./identifiers.ts";

export * from "./taxonomy.ts";
export * from "./units.ts";
export * from "./naming.ts";
export * from "./labels.ts";
export * from "./identifiers.ts";

export const SKU_LIFECYCLE_STATES = [
  "INTAKE",
  "IDENTIFYING",
  "IDENTIFICATION_REQUIRED",
  "IDENTIFIED",
  "ACCOUNTING_MAPPING_REQUIRED",
  "CONTENT_GENERATING",
  "CONTENT_REVIEW",
  "READY",
  "ARCHIVED"
] as const;

export type SkuLifecycleState = (typeof SKU_LIFECYCLE_STATES)[number];

/**
 * §15.1 Explicit SKU Lifecycle State Machine transition table.
 * `ARCHIVED` is terminal (cannot transition back from `ARCHIVED`).
 * `READY` can only be reached from `CONTENT_REVIEW` after all domain preconditions pass.
 */
export const ALLOWED_LIFECYCLE_TRANSITIONS: Readonly<
  Record<SkuLifecycleState, readonly SkuLifecycleState[]>
> = {
  INTAKE: ["IDENTIFYING", "IDENTIFIED", "IDENTIFICATION_REQUIRED", "ARCHIVED"],
  IDENTIFYING: ["IDENTIFICATION_REQUIRED", "IDENTIFIED", "ARCHIVED"],
  IDENTIFICATION_REQUIRED: ["IDENTIFYING", "IDENTIFIED", "ARCHIVED"],
  IDENTIFIED: [
    "IDENTIFICATION_REQUIRED",
    "ACCOUNTING_MAPPING_REQUIRED",
    "CONTENT_GENERATING",
    "ARCHIVED"
  ],
  ACCOUNTING_MAPPING_REQUIRED: [
    "CONTENT_GENERATING",
    "CONTENT_REVIEW",
    "IDENTIFICATION_REQUIRED",
    "ARCHIVED"
  ],
  CONTENT_GENERATING: ["CONTENT_REVIEW", "IDENTIFICATION_REQUIRED", "ARCHIVED"],
  CONTENT_REVIEW: [
    "READY",
    "CONTENT_GENERATING",
    "ACCOUNTING_MAPPING_REQUIRED",
    "IDENTIFICATION_REQUIRED",
    "ARCHIVED"
  ],
  READY: ["CONTENT_REVIEW", "ARCHIVED"],
  ARCHIVED: []
};

export function canTransitionSkuLifecycle(
  fromState: SkuLifecycleState,
  toState: SkuLifecycleState
): boolean {
  return ALLOWED_LIFECYCLE_TRANSITIONS[fromState]?.includes(toState) ?? false;
}

export const IDENTITY_CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW", "CONFLICT"] as const;
export type IdentityConfidenceLevel = (typeof IDENTITY_CONFIDENCE_LEVELS)[number];

export const SKU_IDENTIFIER_TYPES = [
  "GTIN",
  "UPC",
  "MPN",
  "FACTORY_MODEL",
  "PLATE_VALUE",
  "SUPPLIER_CODE",
  "ACCOUNTING_CODE",
  "INTERNAL_SKU",
  "INTERNAL_QR",
  "LEGACY_ALIAS"
] as const;

export type SkuIdentifierType = (typeof SKU_IDENTIFIER_TYPES)[number];

export type PublicAttachableIdentifierType = Exclude<
  SkuIdentifierType,
  "INTERNAL_SKU" | "INTERNAL_QR"
>;

/**
 * Seeds the 8 public top-level categories + UNCLASSIFIED (§5.7) and the 30 initial Product Types (§5.8).
 * Idempotent: safe to call repeatedly.
 */
export async function seedTaxonomyAndProductTypes(db: AppDatabase | DbExecutor): Promise<{
  categoriesCount: number;
  productTypesCount: number;
}> {
  const existingCategories = await db.select().from(categories);
  const categoryIdByKey = new Map<string, string>(
    existingCategories.map((c) => [c.key, c.id])
  );

  for (const catDef of INITIAL_CATEGORIES) {
    if (!categoryIdByKey.has(catDef.key)) {
      const id = createUuidV7();
      await db.insert(categories).values({
        id,
        key: catDef.key,
        nameKa: catDef.nameKa,
        nameEn: catDef.nameEn,
        isUnclassified: catDef.isUnclassified,
        sortOrder: catDef.sortOrder
      });
      categoryIdByKey.set(catDef.key, id);
    }
  }

  const existingTypes = await db.select().from(productTypes);
  const existingTypeKeys = new Set(existingTypes.map((t) => t.key));

  for (const typeDef of INITIAL_PRODUCT_TYPES) {
    if (!existingTypeKeys.has(typeDef.key)) {
      const defaultCategoryId = categoryIdByKey.get(typeDef.defaultCategoryKey);
      if (!defaultCategoryId) {
        throw new AppError(
          "NOT_FOUND",
          `Default category ${typeDef.defaultCategoryKey} not found for product type ${typeDef.key}`
        );
      }

      await db.insert(productTypes).values({
        id: createUuidV7(),
        key: typeDef.key,
        defaultCategoryId,
        nameKa: typeDef.nameKa,
        nameEn: typeDef.nameEn,
        attributeSchemaJson: [...typeDef.attributeSchema],
        photoInstructionsJson: [...typeDef.photoInstructions],
        namingTemplateKa: typeDef.namingTemplateKa,
        namingTemplateEn: typeDef.namingTemplateEn,
        aiResearchContractJson: typeDef.aiResearchContract,
        searchAliasesKa: [...typeDef.searchAliasesKa],
        searchAliasesEn: [...typeDef.searchAliasesEn],
        active: true
      });
    }
  }

  return {
    categoriesCount: categoryIdByKey.size,
    productTypesCount: Math.max(existingTypeKeys.size, INITIAL_PRODUCT_TYPES.length)
  };
}

export async function listCategories(db: AppDatabase | DbExecutor) {
  return db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.key));
}

export async function listProductTypes(db: AppDatabase | DbExecutor) {
  return db.select().from(productTypes).orderBy(asc(productTypes.key));
}

export async function getProductTypeByKey(db: AppDatabase | DbExecutor, key: string) {
  const [pt] = await db
    .select()
    .from(productTypes)
    .where(eq(productTypes.key, key))
    .limit(1);
  if (!pt) {
    throw new AppError("NOT_FOUND", `Product Type "${key}" not found.`);
  }
  return pt;
}

/**
 * §5.8 Adding a new Product Type requires zero database schema changes.
 */
export async function upsertProductType(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  input: {
    key: string;
    defaultCategoryId: string;
    nameKa: string;
    nameEn: string;
    attributeSchemaJson: ProductTypeAttributeFieldDef[];
    photoInstructionsJson: ProductTypePhotoInstructionSlot[];
    namingTemplateKa?: string;
    namingTemplateEn?: string;
    aiResearchContractJson?: ProductTypeAiResearchContract;
    searchAliasesKa?: string[];
    searchAliasesEn?: string[];
  }
) {
  const normalizedKey = input.key.trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,48}$/.test(normalizedKey)) {
    throw new AppError("VALIDATION_ERROR", "Product Type key must be uppercase ASCII [A-Z0-9_].");
  }

  return withDomainTransaction(db, actor, async (ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(productTypes)
      .where(eq(productTypes.key, normalizedKey))
      .limit(1);

    const contract: ProductTypeAiResearchContract = input.aiResearchContractJson ?? {
      requiredIdentityFields: [
        "brand",
        "model_code",
        ...input.attributeSchemaJson
          .filter((f) => f.tier === "REQUIRED_IDENTITY")
          .map((f) => f.key)
      ],
      targetSpecificationFields: input.attributeSchemaJson
        .filter((f) => f.tier !== "REQUIRED_IDENTITY")
        .map((f) => f.key),
      forbidInvention: true,
      unknownFieldPolicy: "NULL_NOT_FOUND"
    };

    if (existing) {
      const [updated] = await ctx.tx
        .update(productTypes)
        .set({
          defaultCategoryId: input.defaultCategoryId,
          nameKa: input.nameKa.trim(),
          nameEn: input.nameEn.trim(),
          attributeSchemaJson: input.attributeSchemaJson,
          photoInstructionsJson: input.photoInstructionsJson,
          namingTemplateKa:
            input.namingTemplateKa ?? "[Brand] [Model] — [Product Type], [Key differentiator]",
          namingTemplateEn:
            input.namingTemplateEn ?? "[Brand] [Model] — [Product Type], [Key differentiator]",
          aiResearchContractJson: contract,
          searchAliasesKa: input.searchAliasesKa ?? existing.searchAliasesKa,
          searchAliasesEn: input.searchAliasesEn ?? existing.searchAliasesEn,
          updatedAt: new Date()
        })
        .where(eq(productTypes.id, existing.id))
        .returning();

      await ctx.recordAudit({
        action: "PRODUCT_TYPE_UPDATED",
        entityType: "product_type",
        entityId: existing.id,
        after: { key: normalizedKey }
      });

      return updated!;
    }

    const id = createUuidV7();
    const [created] = await ctx.tx
      .insert(productTypes)
      .values({
        id,
        key: normalizedKey,
        defaultCategoryId: input.defaultCategoryId,
        nameKa: input.nameKa.trim(),
        nameEn: input.nameEn.trim(),
        attributeSchemaJson: input.attributeSchemaJson,
        photoInstructionsJson: input.photoInstructionsJson,
        namingTemplateKa:
          input.namingTemplateKa ?? "[Brand] [Model] — [Product Type], [Key differentiator]",
        namingTemplateEn:
          input.namingTemplateEn ?? "[Brand] [Model] — [Product Type], [Key differentiator]",
        aiResearchContractJson: contract,
        searchAliasesKa: input.searchAliasesKa ?? [],
        searchAliasesEn: input.searchAliasesEn ?? [],
        active: true
      })
      .returning();

    await ctx.recordAudit({
      action: "PRODUCT_TYPE_CREATED",
      entityType: "product_type",
      entityId: id,
      after: { key: normalizedKey, nameKa: input.nameKa }
    });

    return created!;
  });
}

/**
 * §5.4 Allocates the next monotonic neutral internal SKU ID (`KH-000001`) from PostgreSQL sequence,
 * skipping any explicitly seeded `KH-XXXXXX` values if present.
 */
export async function allocateNextInternalSku(tx: AppDatabase | DbExecutor): Promise<string> {
  while (true) {
    const res = await tx.execute(sql`SELECT nextval('internal_sku_seq') AS seq_val`);
    const row = res.rows[0] as { seq_val?: string | number } | undefined;
    const seqNum = Number(row?.seq_val ?? 1);
    const candidate = `KH-${String(seqNum).padStart(6, "0")}`;

    const [existing] = await tx
      .select({ id: skus.id })
      .from(skus)
      .where(eq(skus.internalSku, candidate))
      .limit(1);

    if (!existing) {
      return candidate;
    }
  }
}

export async function createProductFamily(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  input: {
    code: string;
    productTypeId?: string | null;
    categoryId?: string | null;
    brand?: string | null;
    manufacturer?: string | null;
    baseModel?: string | null;
    titleKa: string;
    titleEn?: string | null;
  }
) {
  return withDomainTransaction(db, actor, async (ctx) => {
    const id = createUuidV7();
    const [created] = await ctx.tx
      .insert(productFamilies)
      .values({
        id,
        code: input.code.trim().toUpperCase(),
        productTypeId: input.productTypeId ?? null,
        categoryId: input.categoryId ?? null,
        brand: input.brand?.trim() ?? null,
        manufacturer: input.manufacturer?.trim() ?? null,
        baseModel: input.baseModel?.trim() ?? null,
        titleKa: input.titleKa.trim(),
        titleEn: input.titleEn?.trim() ?? null
      })
      .returning();

    if (!created) {
      throw new AppError("VALIDATION_ERROR", "Failed to create product family.");
    }

    await ctx.recordAudit({
      action: "PRODUCT_FAMILY_CREATED",
      entityType: "product_family",
      entityId: created.id,
      after: { code: created.code, titleKa: created.titleKa }
    });

    return created;
  });
}

export async function listProductFamilies(db: AppDatabase | DbExecutor) {
  return db.select().from(productFamilies).orderBy(asc(productFamilies.code));
}

export interface CreateSkuDraftInput {
  internalSku?: string; // Optional override for deterministic seed (`KH-000001`); otherwise auto-allocated
  productFamilyId?: string | null;
  productTypeId?: string | null;
  categoryId?: string | null; // Defaults to productType.defaultCategoryId or UNCLASSIFIED
  isComposedBundle?: boolean;
  isKit?: boolean;
  kitComponentsJson?: KitComponentInfo[] | null;
  brand?: string | null;
  manufacturer?: string | null;
  modelCode?: string | null;
  keyDifferentiatorKa?: string | null;
  keyDifferentiatorEn?: string | null;
  universalUnits?: UniversalUnitsInput;
  typeAttributes?: Record<string, SkuAttributeValueEntry>;
  shortDescriptionKa?: string | null;
  shortDescriptionEn?: string | null;
  fullDescriptionKa?: string | null;
  fullDescriptionEn?: string | null;
  searchAliasesKa?: string[];
  searchAliasesEn?: string[];
}

/**
 * Creates a SKU strictly in `INTAKE` state with `identity_confidence = 'LOW'` and `canonical_slug = NULL` ([C8]).
 * Callers cannot bypass the lifecycle state machine or inject a high confidence without evidence/transitions.
 * Also registers system-managed `INTERNAL_SKU` (`KH-XXXXXX`) and `INTERNAL_QR` (`khidi://sku/KH-XXXXXX`).
 */
export async function createSkuDraft(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  input: CreateSkuDraftInput
) {
  if (input.isComposedBundle && input.isKit) {
    throw new AppError(
      "VALIDATION_ERROR",
      "A SKU cannot be both a composed bundle and a factory kit (§5.2)."
    );
  }

  return withDomainTransaction(db, actor, async (ctx) => {
    let resolvedProductType: typeof productTypes.$inferSelect | null = null;
    if (input.productTypeId) {
      const [pt] = await ctx.tx
        .select()
        .from(productTypes)
        .where(eq(productTypes.id, input.productTypeId))
        .limit(1);
      if (!pt) {
        throw new AppError("NOT_FOUND", `Product Type ${input.productTypeId} not found.`);
      }
      resolvedProductType = pt;
    }

    let resolvedCategoryId = input.categoryId ?? resolvedProductType?.defaultCategoryId ?? null;
    if (!resolvedCategoryId) {
      const [unclassified] = await ctx.tx
        .select()
        .from(categories)
        .where(eq(categories.key, "UNCLASSIFIED"))
        .limit(1);
      if (!unclassified) {
        throw new AppError(
          "PRECONDITION_FAILED",
          "UNCLASSIFIED category not found. Run seedTaxonomyAndProductTypes first."
        );
      }
      resolvedCategoryId = unclassified.id;
    }

    const validatedTypeAttributes =
      input.typeAttributes && Object.keys(input.typeAttributes).length > 0
        ? resolvedProductType
          ? validateTypeAttributesAgainstSchema(
              resolvedProductType.attributeSchemaJson,
              input.typeAttributes
            )
          : (() => {
              throw new AppError(
                "VALIDATION_ERROR",
                "Cannot set type_attributes_json without assigning a productTypeId (§5.9)."
              );
            })()
        : {};

    const normalizedUnits = normalizeUniversalUnits(input.universalUnits ?? {});

    const generatedNames = resolvedProductType
      ? generateDeterministicDisplayNames({
          brand: input.brand,
          modelCode: input.modelCode,
          productTypeNameKa: resolvedProductType.nameKa,
          productTypeNameEn: resolvedProductType.nameEn,
          keyDifferentiatorKa: input.keyDifferentiatorKa,
          keyDifferentiatorEn: input.keyDifferentiatorEn
        })
      : { displayNameKa: null, displayNameEn: null };

    const mergedAliasesKa = Array.from(
      new Set([
        ...(resolvedProductType?.searchAliasesKa ?? []),
        ...(input.searchAliasesKa ?? [])
      ])
    );
    const mergedAliasesEn = Array.from(
      new Set([
        ...(resolvedProductType?.searchAliasesEn ?? []),
        ...(input.searchAliasesEn ?? [])
      ])
    );

    const internalSku = input.internalSku?.trim() || (await allocateNextInternalSku(ctx.tx));
    const skuId = createUuidV7();

    const [created] = await ctx.tx
      .insert(skus)
      .values({
        id: skuId,
        internalSku,
        productFamilyId: input.productFamilyId ?? null,
        productTypeId: input.productTypeId ?? null,
        categoryId: resolvedCategoryId,
        canonicalSlug: null, // [C8] Strictly NULL before READY!
        lifecycleState: "INTAKE", // §15.1 Always starts in INTAKE
        identityConfidence: "LOW", // Always starts in LOW until evidence/review transitions it
        isComposedBundle: input.isComposedBundle ?? false,
        isKit: input.isKit ?? false,
        kitComponentsJson: input.kitComponentsJson ?? null,
        brand: input.brand?.trim() ?? null,
        manufacturer: input.manufacturer?.trim() ?? null,
        modelCode: input.modelCode?.trim() ?? null,
        keyDifferentiatorKa: input.keyDifferentiatorKa?.trim() ?? null,
        keyDifferentiatorEn: input.keyDifferentiatorEn?.trim() ?? null,
        powerKw: normalizedUnits.powerKw,
        engineDisplacementCm3: normalizedUnits.engineDisplacementCm3,
        lengthMm: normalizedUnits.lengthMm,
        widthMm: normalizedUnits.widthMm,
        heightMm: normalizedUnits.heightMm,
        workingWidthMm: normalizedUnits.workingWidthMm,
        workingDepthMm: normalizedUnits.workingDepthMm,
        weightKg: normalizedUnits.weightKg,
        volumeL: normalizedUnits.volumeL,
        pressureBar: normalizedUnits.pressureBar,
        flowLMin: normalizedUnits.flowLMin,
        voltageV: normalizedUnits.voltageV,
        currentA: normalizedUnits.currentA,
        unitSourceStringsJson: normalizedUnits.unitSourceStringsJson,
        unitMetadataJson: normalizedUnits.unitMetadataJson,
        typeAttributesJson: validatedTypeAttributes,
        displayNameKa: generatedNames.displayNameKa,
        displayNameEn: generatedNames.displayNameEn,
        shortDescriptionKa: input.shortDescriptionKa ?? null,
        shortDescriptionEn: input.shortDescriptionEn ?? null,
        fullDescriptionKa: input.fullDescriptionKa ?? null,
        fullDescriptionEn: input.fullDescriptionEn ?? null,
        searchAliasesKa: mergedAliasesKa,
        searchAliasesEn: mergedAliasesEn
      })
      .returning();

    if (!created) {
      throw new AppError("VALIDATION_ERROR", "Failed to create SKU draft.");
    }

    // Automatically attach system-only INTERNAL_SKU and INTERNAL_QR identifiers (§5.3, §5.4)
    await ctx.tx.insert(skuIdentifiers).values([
      {
        id: createUuidV7(),
        skuId: created.id,
        identifierType: "INTERNAL_SKU",
        value: internalSku,
        issuerSource: "KHIDI_HUB",
        verified: true,
        isPrimary: true,
        hasCollision: false
      },
      {
        id: createUuidV7(),
        skuId: created.id,
        identifierType: "INTERNAL_QR",
        value: `khidi://sku/${internalSku}`,
        issuerSource: "KHIDI_HUB",
        verified: true,
        isPrimary: false,
        hasCollision: false
      }
    ]);

    await ctx.recordAudit({
      action: "SKU_DRAFT_CREATED",
      entityType: "sku",
      entityId: created.id,
      after: {
        internalSku: created.internalSku,
        lifecycleState: created.lifecycleState,
        identityConfidence: created.identityConfidence,
        canonicalSlug: created.canonicalSlug,
        productTypeId: created.productTypeId,
        isComposedBundle: created.isComposedBundle,
        isKit: created.isKit
      }
    });

    return created;
  });
}

/**
 * §15.1 Transitions a SKU between non-READY states according to `ALLOWED_LIFECYCLE_TRANSITIONS`.
 * If transitioning to `ARCHIVED`, also recomputes collision flags on any shared identifiers.
 */
export async function transitionSkuLifecycle(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  skuId: string,
  targetState: Exclude<SkuLifecycleState, "READY">,
  options?: {
    identityConfidence?: IdentityConfidenceLevel;
    reason?: string;
  }
) {
  return withDomainTransaction(db, actor, async (ctx) => {
    const [sku] = await ctx.tx.select().from(skus).where(eq(skus.id, skuId)).limit(1);
    if (!sku) {
      throw new AppError("NOT_FOUND", `SKU ${skuId} not found.`);
    }

    const currentState = sku.lifecycleState as SkuLifecycleState;
    if (!canTransitionSkuLifecycle(currentState, targetState)) {
      throw new AppError(
        "PRECONDITION_FAILED",
        `Invalid SKU lifecycle transition from "${currentState}" to "${targetState}" (§15.1). Allowed next states: [${ALLOWED_LIFECYCLE_TRANSITIONS[currentState].join(", ")}].`
      );
    }

    const nextConfidence =
      options?.identityConfidence ?? (sku.identityConfidence as IdentityConfidenceLevel);

    const [updated] = await ctx.tx
      .update(skus)
      .set({
        lifecycleState: targetState,
        identityConfidence: nextConfidence,
        updatedAt: new Date()
      })
      .where(eq(skus.id, sku.id))
      .returning();

    if (targetState === "ARCHIVED") {
      // Recompute collision state for all identifiers attached to this SKU
      const attached = await ctx.tx
        .select()
        .from(skuIdentifiers)
        .where(eq(skuIdentifiers.skuId, sku.id));

      for (const idRow of attached) {
        await recomputeIdentifierCollisionState(ctx.tx, idRow.identifierType, idRow.value);
      }

      await ctx.emitOutboxEvent({
        eventType: "PRODUCT_ARCHIVED",
        aggregateType: "product",
        aggregateId: sku.id,
        payload: { skuId: sku.id, internalSku: sku.internalSku },
        consumers: ["notifications"]
      });
    }

    await ctx.recordAudit({
      action: "SKU_LIFECYCLE_TRANSITIONED",
      entityType: "sku",
      entityId: sku.id,
      before: {
        lifecycleState: sku.lifecycleState,
        identityConfidence: sku.identityConfidence
      },
      after: {
        lifecycleState: targetState,
        identityConfidence: nextConfidence
      },
      reason: options?.reason
    });

    return updated!;
  });
}

async function resolveUniqueCanonicalSlug(
  tx: AppDatabase | DbExecutor,
  skuId: string,
  desiredSlug: string,
  allowAutoSuffix = false
): Promise<string> {
  let candidate = desiredSlug;
  let counter = 1;

  while (true) {
    const [existingSku] = await tx
      .select({ id: skus.id })
      .from(skus)
      .where(and(eq(skus.canonicalSlug, candidate), ne(skus.id, skuId)))
      .limit(1);

    const [existingHistory] = await tx
      .select({ skuId: skuSlugHistory.skuId })
      .from(skuSlugHistory)
      .where(and(eq(skuSlugHistory.oldSlug, candidate), ne(skuSlugHistory.skuId, skuId)))
      .limit(1);

    if (!existingSku && !existingHistory) {
      return candidate;
    }

    if (!allowAutoSuffix) {
      throw new AppError(
        "CONFLICT",
        `Canonical slug "${candidate}" is already in use or reserved in slug history by another SKU [C8].`
      );
    }

    counter += 1;
    candidate = `${desiredSlug}-${counter}`;
  }
}

/**
 * §15.1 & [C8] Transitions a SKU from `CONTENT_REVIEW` to `READY`.
 * Enforces domain preconditions:
 * 1. Current state must be `CONTENT_REVIEW` (never `INTAKE`, `ARCHIVED`, etc.).
 * 2. `actor.userId` is required (`approved_by`).
 * 3. `identity_confidence` must be `HIGH`, or `MEDIUM` with `humanConfirmedMediumConfidence = true` (`LOW` and `CONFLICT` are forbidden).
 * 4. `product_type_id` must be assigned and category must not be `UNCLASSIFIED`.
 * 5. `brand` and `model_code` must be present.
 * 6. At least one active `accounting_mappings` row must exist for the SKU.
 * 7. When the SKU belongs to a multi-SKU Product Family (or shares `brand` + `model_code` with another SKU),
 *    includes the variant differentiator in `canonical_slug` so variant slugs are deterministic and independent of approval order.
 */
export async function transitionSkuToReady(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  skuId: string,
  options?: {
    customCanonicalSlug?: string;
    humanConfirmedMediumConfidence?: boolean;
  }
) {
  if (!actor.userId) {
    throw new AppError(
      "PRECONDITION_FAILED",
      "Transitioning a SKU to READY requires an authenticated human approver (actor.userId)."
    );
  }

  return withDomainTransaction(db, actor, async (ctx) => {
    const [sku] = await ctx.tx.select().from(skus).where(eq(skus.id, skuId)).limit(1);
    if (!sku) {
      throw new AppError("NOT_FOUND", `SKU ${skuId} not found.`);
    }

    const currentState = sku.lifecycleState as SkuLifecycleState;
    if (!canTransitionSkuLifecycle(currentState, "READY")) {
      throw new AppError(
        "PRECONDITION_FAILED",
        `SKU ${sku.internalSku} cannot transition to READY from "${currentState}"; it must be in "CONTENT_REVIEW" first (§15.1).`
      );
    }

    if (sku.identityConfidence === "LOW" || sku.identityConfidence === "CONFLICT") {
      throw new AppError(
        "PRECONDITION_FAILED",
        `SKU ${sku.internalSku} has identity_confidence="${sku.identityConfidence}" and cannot transition to READY (§15.1).`
      );
    }

    if (sku.identityConfidence === "MEDIUM" && !options?.humanConfirmedMediumConfidence) {
      throw new AppError(
        "PRECONDITION_FAILED",
        `SKU ${sku.internalSku} has identity_confidence="MEDIUM" and requires explicit human confirmation (humanConfirmedMediumConfidence: true) to transition to READY (§15.1).`
      );
    }

    if (!sku.brand?.trim() || !sku.modelCode?.trim()) {
      throw new AppError(
        "PRECONDITION_FAILED",
        `SKU ${sku.internalSku} requires verified brand and model_code before transitioning to READY.`
      );
    }

    if (!sku.productTypeId) {
      throw new AppError(
        "PRECONDITION_FAILED",
        "SKU must have an assigned Product Type before transitioning to READY."
      );
    }

    const [productType] = await ctx.tx
      .select()
      .from(productTypes)
      .where(eq(productTypes.id, sku.productTypeId))
      .limit(1);

    if (!productType) {
      throw new AppError("NOT_FOUND", `Product Type ${sku.productTypeId} not found.`);
    }

    const [cat] = await ctx.tx
      .select()
      .from(categories)
      .where(eq(categories.id, sku.categoryId))
      .limit(1);

    if (!cat || cat.isUnclassified) {
      throw new AppError(
        "PRECONDITION_FAILED",
        "SKU in UNCLASSIFIED category cannot transition to READY (§5.7)."
      );
    }

    const activeMappings = await ctx.tx
      .select({ id: accountingMappings.id })
      .from(accountingMappings)
      .where(and(eq(accountingMappings.skuId, sku.id), eq(accountingMappings.active, true)))
      .limit(1);

    if (activeMappings.length === 0) {
      throw new AppError(
        "PRECONDITION_FAILED",
        `SKU ${sku.internalSku} requires at least one active accounting_mapping before transitioning to READY (§5.5, §15.1).`
      );
    }

    // Check if this SKU is part of a multi-SKU Product Family or shares (brand, model_code) with another SKU
    let shouldIncludeDifferentiator = false;
    if (sku.productFamilyId) {
      const familySiblings = await ctx.tx
        .select({ id: skus.id })
        .from(skus)
        .where(and(eq(skus.productFamilyId, sku.productFamilyId), ne(skus.id, sku.id)))
        .limit(1);
      if (familySiblings.length > 0) {
        shouldIncludeDifferentiator = true;
      }
    }
    if (!shouldIncludeDifferentiator && sku.brand && sku.modelCode) {
      const sameModelSiblings = await ctx.tx
        .select({ id: skus.id })
        .from(skus)
        .where(
          and(
            eq(skus.brand, sku.brand),
            eq(skus.modelCode, sku.modelCode),
            ne(skus.id, sku.id)
          )
        )
        .limit(1);
      if (sameModelSiblings.length > 0) {
        shouldIncludeDifferentiator = true;
      }
    }

    const differentiatorForSlug = sku.keyDifferentiatorEn ?? sku.keyDifferentiatorKa ?? null;
    if (shouldIncludeDifferentiator && !differentiatorForSlug && !options?.customCanonicalSlug) {
      throw new AppError(
        "PRECONDITION_FAILED",
        `SKU ${sku.internalSku} belongs to a multi-variant family/model and requires keyDifferentiatorEn or keyDifferentiatorKa to generate a distinct variant slug.`
      );
    }

    const baseSlug = options?.customCanonicalSlug
      ? generateCanonicalSlug(options.customCanonicalSlug, null)
      : sku.canonicalSlug ??
        generateCanonicalSlug(
          sku.brand,
          sku.modelCode,
          differentiatorForSlug,
          sku.internalSku
        );

    const finalSlug = await resolveUniqueCanonicalSlug(
      ctx.tx,
      sku.id,
      baseSlug,
      !options?.customCanonicalSlug
    );

    if (sku.canonicalSlug && sku.canonicalSlug !== finalSlug) {
      await ctx.tx.insert(skuSlugHistory).values({
        id: createUuidV7(),
        skuId: sku.id,
        oldSlug: sku.canonicalSlug
      });
    }

    const names = generateDeterministicDisplayNames({
      brand: sku.brand,
      modelCode: sku.modelCode,
      productTypeNameKa: productType.nameKa,
      productTypeNameEn: productType.nameEn,
      keyDifferentiatorKa: sku.keyDifferentiatorKa,
      keyDifferentiatorEn: sku.keyDifferentiatorEn
    });

    if (!names.displayNameKa || !names.displayNameEn) {
      throw new AppError(
        "PRECONDITION_FAILED",
        "Deterministic KA and EN display names are required before transitioning to READY (§5.10)."
      );
    }

    const [updated] = await ctx.tx
      .update(skus)
      .set({
        lifecycleState: "READY",
        canonicalSlug: finalSlug,
        displayNameKa: names.displayNameKa,
        displayNameEn: names.displayNameEn,
        approvedBy: actor.userId,
        approvedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(skus.id, sku.id))
      .returning();

    await ctx.recordAudit({
      action: "SKU_TRANSITIONED_TO_READY",
      entityType: "sku",
      entityId: sku.id,
      before: {
        lifecycleState: sku.lifecycleState,
        canonicalSlug: sku.canonicalSlug
      },
      after: {
        lifecycleState: "READY",
        canonicalSlug: finalSlug,
        identityConfidence: sku.identityConfidence
      }
    });

    await ctx.emitOutboxEvent({
      eventType: "PRODUCT_APPROVED",
      aggregateType: "product",
      aggregateId: sku.id,
      payload: {
        skuId: sku.id,
        internalSku: sku.internalSku,
        canonicalSlug: finalSlug
      },
      consumers: ["notifications"]
    });

    return updated!;
  });
}

/**
 * §5.11 & [C7, C8] Updates `canonical_slug` on a SKU that already has a slug,
 * preserving the previous slug in append-only `sku_slug_history`.
 */
export async function updateSkuCanonicalSlug(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  skuId: string,
  newSlugRaw: string,
  reason?: string
) {
  const normalizedNewSlug = generateCanonicalSlug(newSlugRaw, null);

  return withDomainTransaction(db, actor, async (ctx) => {
    const [sku] = await ctx.tx.select().from(skus).where(eq(skus.id, skuId)).limit(1);
    if (!sku) {
      throw new AppError("NOT_FOUND", `SKU ${skuId} not found.`);
    }

    if (sku.canonicalSlug === normalizedNewSlug) {
      return sku;
    }

    const finalSlug = await resolveUniqueCanonicalSlug(ctx.tx, sku.id, normalizedNewSlug, false);

    if (sku.canonicalSlug) {
      const [alreadyInHistory] = await ctx.tx
        .select()
        .from(skuSlugHistory)
        .where(eq(skuSlugHistory.oldSlug, sku.canonicalSlug))
        .limit(1);

      if (!alreadyInHistory) {
        await ctx.tx.insert(skuSlugHistory).values({
          id: createUuidV7(),
          skuId: sku.id,
          oldSlug: sku.canonicalSlug
        });
      }
    }

    const [updated] = await ctx.tx
      .update(skus)
      .set({
        canonicalSlug: finalSlug,
        updatedAt: new Date()
      })
      .where(eq(skus.id, sku.id))
      .returning();

    await ctx.recordAudit({
      action: "SKU_CANONICAL_SLUG_CHANGED",
      entityType: "sku",
      entityId: sku.id,
      before: { canonicalSlug: sku.canonicalSlug },
      after: { canonicalSlug: finalSlug },
      reason
    });

    return updated!;
  });
}

export async function listSkuSlugHistory(db: AppDatabase | DbExecutor, skuId: string) {
  return db
    .select()
    .from(skuSlugHistory)
    .where(eq(skuSlugHistory.skuId, skuId))
    .orderBy(desc(skuSlugHistory.changedAt));
}

/**
 * §5.2 Configures the components of a Composed Bundle (`is_composed_bundle = true`).
 * Prevents self-reference and nested bundle-in-bundle cycles.
 */
export async function setComposedBundleComponents(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  bundleSkuId: string,
  components: Array<{ componentSkuId: string; quantity: number }>
) {
  if (components.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "A composed bundle must have at least one component SKU (§5.2)."
    );
  }

  return withDomainTransaction(db, actor, async (ctx) => {
    const [bundleSku] = await ctx.tx
      .select()
      .from(skus)
      .where(eq(skus.id, bundleSkuId))
      .limit(1);

    if (!bundleSku) {
      throw new AppError("NOT_FOUND", `Bundle SKU ${bundleSkuId} not found.`);
    }
    if (!bundleSku.isComposedBundle) {
      throw new AppError(
        "PRECONDITION_FAILED",
        `SKU ${bundleSku.internalSku} is not marked as is_composed_bundle = true.`
      );
    }

    const componentIds = components.map((c) => c.componentSkuId);
    if (componentIds.includes(bundleSkuId)) {
      throw new AppError("VALIDATION_ERROR", "A bundle SKU cannot contain itself as a component.");
    }

    const uniqueComponentIds = new Set(componentIds);
    if (uniqueComponentIds.size !== componentIds.length) {
      throw new AppError("VALIDATION_ERROR", "Duplicate componentSkuId in bundle components.");
    }

    const targetSkus = await ctx.tx
      .select()
      .from(skus)
      .where(inArray(skus.id, [...uniqueComponentIds]));

    if (targetSkus.length !== uniqueComponentIds.size) {
      throw new AppError("NOT_FOUND", "One or more component SKUs do not exist.");
    }

    if (targetSkus.some((s) => s.isComposedBundle)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Nested composed bundles (a bundle containing another composed bundle) are forbidden."
      );
    }

    for (const comp of components) {
      if (!Number.isInteger(comp.quantity) || comp.quantity <= 0) {
        throw new AppError("VALIDATION_ERROR", "Bundle component quantity must be a positive integer.");
      }
    }

    await ctx.tx.delete(bundleComponents).where(eq(bundleComponents.bundleSkuId, bundleSkuId));
    await ctx.tx.insert(bundleComponents).values(
      components.map((comp) => ({
        bundleSkuId,
        componentSkuId: comp.componentSkuId,
        quantity: comp.quantity
      }))
    );

    await ctx.recordAudit({
      action: "BUNDLE_COMPONENTS_UPDATED",
      entityType: "sku",
      entityId: bundleSkuId,
      after: { components }
    });

    return components;
  });
}

export async function getBundleComponents(db: AppDatabase | DbExecutor, bundleSkuId: string) {
  return db
    .select({
      bundleSkuId: bundleComponents.bundleSkuId,
      componentSkuId: bundleComponents.componentSkuId,
      componentInternalSku: skus.internalSku,
      componentDisplayNameKa: skus.displayNameKa,
      quantity: bundleComponents.quantity
    })
    .from(bundleComponents)
    .innerJoin(skus, eq(bundleComponents.componentSkuId, skus.id))
    .where(eq(bundleComponents.bundleSkuId, bundleSkuId));
}

/**
 * Recomputes `has_collision` across all non-ARCHIVED SKUs for a given `(identifierType, value)`
 * under a transaction-scoped advisory lock (`pg_advisory_xact_lock`).
 * If <= 1 active SKU holds the identifier, clears `has_collision = false`.
 */
async function recomputeIdentifierCollisionState(
  tx: AppDatabase | DbExecutor,
  identifierType: string,
  value: string
): Promise<{ collisionDetected: boolean; activeSkuIds: string[] }> {
  const lockKey = `sku_id_lock:${identifierType}:${value}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

  const rowsWithSku = await tx
    .select({
      identifierId: skuIdentifiers.id,
      skuId: skuIdentifiers.skuId,
      lifecycleState: skus.lifecycleState
    })
    .from(skuIdentifiers)
    .innerJoin(skus, eq(skuIdentifiers.skuId, skus.id))
    .where(
      and(
        eq(skuIdentifiers.identifierType, identifierType),
        eq(skuIdentifiers.value, value)
      )
    );

  const activeSkuIds = Array.from(
    new Set(
      rowsWithSku
        .filter((r) => r.lifecycleState !== "ARCHIVED")
        .map((r) => r.skuId)
    )
  );
  const collisionDetected = activeSkuIds.length > 1;

  await tx
    .update(skuIdentifiers)
    .set({ hasCollision: collisionDetected })
    .where(
      and(
        eq(skuIdentifiers.identifierType, identifierType),
        eq(skuIdentifiers.value, value)
      )
    );

  return { collisionDetected, activeSkuIds };
}

/**
 * §5.3 Attaches an external identifier/barcode (`GTIN`, `UPC`, `MPN`, `FACTORY_MODEL`, etc.) to a SKU.
 * - Forbids manual attachment of `INTERNAL_SKU` or `INTERNAL_QR` (system-generated only).
 * - Normalizes `GTIN` and `UPC` to 14-digit `GTIN-14` (`identifierType = "GTIN"`) after validating the GS1 Modulo-10 check digit.
 * - Uses `pg_advisory_xact_lock` on `(identifier_type, value)` so concurrent attachments cannot miss a collision.
 */
export async function attachSkuIdentifier(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  input: {
    skuId: string;
    identifierType: SkuIdentifierType;
    value: string;
    issuerSource?: string;
    verified?: boolean;
    isPrimary?: boolean;
  }
): Promise<{
  identifier: typeof skuIdentifiers.$inferSelect;
  collisionDetected: boolean;
  conflictingSkuIds: string[];
}> {
  if (
    input.identifierType === "INTERNAL_SKU" ||
    input.identifierType === "INTERNAL_QR"
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      `${input.identifierType} is a system-managed identifier and cannot be attached manually (§5.4).`
    );
  }

  const { canonicalType, canonicalValue } = normalizeIdentifierOnWrite(
    input.identifierType,
    input.value
  );

  return withDomainTransaction(db, actor, async (ctx) => {
    const lockKey = `sku_id_lock:${canonicalType}:${canonicalValue}`;
    await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const id = createUuidV7();
    await ctx.tx.insert(skuIdentifiers).values({
      id,
      skuId: input.skuId,
      identifierType: canonicalType,
      value: canonicalValue,
      issuerSource: input.issuerSource?.trim() ?? null,
      verified: input.verified ?? false,
      isPrimary: input.isPrimary ?? false,
      hasCollision: false
    });

    const { collisionDetected, activeSkuIds } = await recomputeIdentifierCollisionState(
      ctx.tx,
      canonicalType,
      canonicalValue
    );

    const conflictingSkuIds = activeSkuIds.filter((sId) => sId !== input.skuId);

    const [created] = await ctx.tx
      .select()
      .from(skuIdentifiers)
      .where(eq(skuIdentifiers.id, id))
      .limit(1);

    if (!created) {
      throw new AppError("VALIDATION_ERROR", "Failed to attach SKU identifier.");
    }

    await ctx.recordAudit({
      action: collisionDetected
        ? "SKU_IDENTIFIER_COLLISION_DETECTED"
        : "SKU_IDENTIFIER_ATTACHED",
      entityType: "sku",
      entityId: input.skuId,
      after: {
        identifierId: created.id,
        identifierType: created.identifierType,
        value: created.value,
        collisionDetected,
        conflictingSkuIds
      }
    });

    return {
      identifier: created,
      collisionDetected,
      conflictingSkuIds
    };
  });
}

/**
 * Removes an external identifier from a SKU (e.g. when resolving a barcode collision)
 * and automatically clears `has_collision` on the remaining SKU if the collision is resolved.
 * System-managed `INTERNAL_SKU` and `INTERNAL_QR` cannot be removed.
 */
export async function removeSkuIdentifier(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  identifierId: string,
  reason?: string
): Promise<{ collisionStillPresent: boolean; remainingActiveSkuIds: string[] }> {
  return withDomainTransaction(db, actor, async (ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(skuIdentifiers)
      .where(eq(skuIdentifiers.id, identifierId))
      .limit(1);

    if (!existing) {
      throw new AppError("NOT_FOUND", `Identifier ${identifierId} not found.`);
    }

    if (
      existing.identifierType === "INTERNAL_SKU" ||
      existing.identifierType === "INTERNAL_QR"
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        `System-managed ${existing.identifierType} cannot be removed.`
      );
    }

    const lockKey = `sku_id_lock:${existing.identifierType}:${existing.value}`;
    await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

    await ctx.tx.delete(skuIdentifiers).where(eq(skuIdentifiers.id, existing.id));

    const { collisionDetected, activeSkuIds } = await recomputeIdentifierCollisionState(
      ctx.tx,
      existing.identifierType,
      existing.value
    );

    await ctx.recordAudit({
      action: "SKU_IDENTIFIER_REMOVED",
      entityType: "sku",
      entityId: existing.skuId,
      before: {
        identifierId: existing.id,
        identifierType: existing.identifierType,
        value: existing.value
      },
      after: {
        collisionStillPresent: collisionDetected,
        remainingActiveSkuIds: activeSkuIds
      },
      reason
    });

    return {
      collisionStillPresent: collisionDetected,
      remainingActiveSkuIds: activeSkuIds
    };
  });
}

export async function listSkuIdentifiers(db: AppDatabase | DbExecutor, skuId: string) {
  return db
    .select()
    .from(skuIdentifiers)
    .where(eq(skuIdentifiers.skuId, skuId))
    .orderBy(desc(skuIdentifiers.isPrimary), asc(skuIdentifiers.identifierType));
}

/**
 * §5.3 Resolves a scanned barcode/QR string against `sku_identifiers`.
 * - Normalizes 8/12/13/14-digit GS1 barcodes to 14-digit GTIN-14 so UPC-A (12 digits) and EAN-13 (13 digits with leading 0) match.
 * - Excludes `ARCHIVED` SKUs by default (`options.includeArchived = false`).
 */
export async function resolveSkuByScannedIdentifier(
  db: AppDatabase | DbExecutor,
  scannedValue: string,
  options?: { includeArchived?: boolean }
) {
  const candidates = buildCandidateLookupValues(scannedValue);
  if (candidates.length === 0) {
    return { matches: [], uniqueSkuIds: [], isAmbiguousCollision: false };
  }

  const conditions = [inArray(skuIdentifiers.value, candidates)];
  if (!options?.includeArchived) {
    conditions.push(ne(skus.lifecycleState, "ARCHIVED"));
  }

  const rows = await db
    .select({
      identifierId: skuIdentifiers.id,
      identifierType: skuIdentifiers.identifierType,
      value: skuIdentifiers.value,
      hasCollision: skuIdentifiers.hasCollision,
      skuId: skus.id,
      internalSku: skus.internalSku,
      displayNameKa: skus.displayNameKa,
      lifecycleState: skus.lifecycleState
    })
    .from(skuIdentifiers)
    .innerJoin(skus, eq(skuIdentifiers.skuId, skus.id))
    .where(and(...conditions));

  const uniqueSkuIds = Array.from(new Set(rows.map((r) => r.skuId)));
  return {
    matches: rows,
    uniqueSkuIds,
    isAmbiguousCollision: uniqueSkuIds.length > 1
  };
}

/**
 * §5.5 & [C9] Accounting Mappings (`legal_entity_id`).
 * Preserves `accounting_item_id` (e.g. `1610/00004/0009`) and `accounting_name` verbatim without parsing structure.
 */
export async function upsertAccountingMapping(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  input: {
    skuId: string;
    legalEntityId: string; // [C9]
    accountingItemId: string;
    accountingName: string;
    legacyCode?: string | null;
    notes?: string | null;
    replaceExistingForEntity?: boolean;
  }
) {
  const accountingItemId = input.accountingItemId.trim();
  // Preserve accountingName exactly as entered (§5.5), only rejecting empty string
  const accountingName = input.accountingName;
  if (!accountingItemId || !accountingName.trim()) {
    throw new AppError(
      "VALIDATION_ERROR",
      "accountingItemId and accountingName are required (§5.5)."
    );
  }

  return withDomainTransaction(db, actor, async (ctx) => {
    const [entity] = await ctx.tx
      .select()
      .from(legalEntities)
      .where(eq(legalEntities.id, input.legalEntityId))
      .limit(1);
    if (!entity) {
      throw new AppError("NOT_FOUND", `Legal entity ${input.legalEntityId} not found.`);
    }

    if (input.replaceExistingForEntity) {
      await ctx.tx
        .update(accountingMappings)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(accountingMappings.skuId, input.skuId),
            eq(accountingMappings.legalEntityId, input.legalEntityId),
            eq(accountingMappings.active, true)
          )
        );
    }

    const id = createUuidV7();
    const [created] = await ctx.tx
      .insert(accountingMappings)
      .values({
        id,
        skuId: input.skuId,
        legalEntityId: input.legalEntityId,
        accountingItemId,
        accountingName,
        legacyCode: input.legacyCode ?? null,
        active: true,
        notes: input.notes ?? null,
        createdBy: actor.userId ?? null
      })
      .returning();

    if (!created) {
      throw new AppError("VALIDATION_ERROR", "Failed to save accounting mapping.");
    }

    await ctx.recordAudit({
      action: "ACCOUNTING_MAPPING_SAVED",
      entityType: "accounting_mapping",
      entityId: created.id,
      after: {
        skuId: created.skuId,
        legalEntityId: created.legalEntityId,
        legalEntityKey: entity.key,
        accountingItemId: created.accountingItemId,
        accountingName: created.accountingName,
        active: created.active
      }
    });

    return created;
  });
}

export async function listAccountingMappingsForSku(
  db: AppDatabase | DbExecutor,
  skuId: string,
  options?: { activeOnly?: boolean }
) {
  const conditions = [eq(accountingMappings.skuId, skuId)];
  if (options?.activeOnly) {
    conditions.push(eq(accountingMappings.active, true));
  }

  return db
    .select({
      id: accountingMappings.id,
      skuId: accountingMappings.skuId,
      legalEntityId: accountingMappings.legalEntityId,
      legalEntityKey: legalEntities.key,
      legalEntityName: legalEntities.legalName,
      accountingItemId: accountingMappings.accountingItemId,
      accountingName: accountingMappings.accountingName,
      legacyCode: accountingMappings.legacyCode,
      active: accountingMappings.active,
      notes: accountingMappings.notes,
      createdAt: accountingMappings.createdAt
    })
    .from(accountingMappings)
    .innerJoin(legalEntities, eq(accountingMappings.legalEntityId, legalEntities.id))
    .where(and(...conditions))
    .orderBy(asc(legalEntities.key), desc(accountingMappings.createdAt));
}

/**
 * §4.5 Storefront Listings:
 * Explicit admin decision per storefront and SKU, audited and emitting `LISTING_CHANGED` through the outbox.
 */
export async function setStorefrontListing(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  input: {
    storefrontId: string;
    skuId: string;
    enabled: boolean;
    reason?: string;
  }
) {
  return withDomainTransaction(db, actor, async (ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(storefrontListings)
      .where(
        and(
          eq(storefrontListings.storefrontId, input.storefrontId),
          eq(storefrontListings.skuId, input.skuId)
        )
      )
      .limit(1);

    const now = new Date();
    let resultRow: typeof storefrontListings.$inferSelect;

    if (existing) {
      const [updated] = await ctx.tx
        .update(storefrontListings)
        .set({
          enabled: input.enabled,
          enabledAt: input.enabled ? now : existing.enabledAt,
          enabledBy: input.enabled ? (actor.userId ?? null) : existing.enabledBy,
          disabledAt: !input.enabled ? now : existing.disabledAt,
          disabledBy: !input.enabled ? (actor.userId ?? null) : existing.disabledBy,
          reason: input.reason ?? existing.reason,
          updatedAt: now
        })
        .where(eq(storefrontListings.id, existing.id))
        .returning();
      resultRow = updated!;
    } else {
      const [created] = await ctx.tx
        .insert(storefrontListings)
        .values({
          id: createUuidV7(),
          storefrontId: input.storefrontId,
          skuId: input.skuId,
          enabled: input.enabled,
          enabledAt: input.enabled ? now : null,
          enabledBy: input.enabled ? (actor.userId ?? null) : null,
          disabledAt: !input.enabled ? now : null,
          disabledBy: !input.enabled ? (actor.userId ?? null) : null,
          reason: input.reason ?? null,
          updatedAt: now
        })
        .returning();
      resultRow = created!;
    }

    await ctx.recordAudit({
      action: "STOREFRONT_LISTING_CHANGED",
      entityType: "storefront_listing",
      entityId: resultRow.id,
      before: existing ? { enabled: existing.enabled } : null,
      after: {
        storefrontId: input.storefrontId,
        skuId: input.skuId,
        enabled: input.enabled
      },
      reason: input.reason
    });

    await ctx.emitOutboxEvent({
      eventType: "LISTING_CHANGED",
      storefrontId: input.storefrontId,
      aggregateType: "storefront_listing",
      aggregateId: resultRow.id,
      payload: {
        storefrontId: input.storefrontId,
        skuId: input.skuId,
        enabled: input.enabled
      },
      consumers: [`storefront:${input.storefrontId}`]
    });

    return resultRow;
  });
}

export async function listStorefrontListingsForSku(
  db: AppDatabase | DbExecutor,
  skuId: string
) {
  return db
    .select({
      id: storefrontListings.id,
      storefrontId: storefrontListings.storefrontId,
      storefrontKey: storefronts.key,
      storefrontName: storefronts.name,
      skuId: storefrontListings.skuId,
      enabled: storefrontListings.enabled,
      enabledAt: storefrontListings.enabledAt,
      disabledAt: storefrontListings.disabledAt,
      reason: storefrontListings.reason
    })
    .from(storefrontListings)
    .innerJoin(storefronts, eq(storefrontListings.storefrontId, storefronts.id))
    .where(eq(storefrontListings.skuId, skuId))
    .orderBy(asc(storefronts.key));
}

export const registerLegacyUrlSchema = z.object({
  oldHost: z.string().trim().min(3),
  oldPathRaw: z.string().trim().min(1),
  entityType: z.enum(["PRODUCT", "CATEGORY", "OTHER"]),
  entityId: z.string().uuid().nullable().optional(),
  decision: z.enum(["KEEP_301", "ARCHIVE_PAGE", "GONE_410", "UNDECIDED"]).default("UNDECIDED"),
  gscClicks16m: z.number().int().nonnegative().nullable().optional(),
  gscImpressions16m: z.number().int().nonnegative().nullable().optional(),
  backlinks: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(1000).nullable().optional()
});

/**
 * §12.5 Registers a legacy URL with normalized path and enforces anti-catch-all rules
 * (`KEEP_301` requires an exact target `entityId`).
 */
export async function registerLegacyUrl(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  rawInput: z.input<typeof registerLegacyUrlSchema>
) {
  const input = registerLegacyUrlSchema.parse(rawInput);
  const oldPathNormalized = normalizeLegacyUrlPath(input.oldPathRaw);

  if (input.decision === "KEEP_301" && !input.entityId) {
    throw new AppError(
      "VALIDATION_ERROR",
      "KEEP_301 decision requires an exact target entityId (mass redirects to homepage/shop are forbidden per §12.5)."
    );
  }

  return withDomainTransaction(db, actor, async (ctx) => {
    const id = createUuidV7();
    const [created] = await ctx.tx
      .insert(legacyUrls)
      .values({
        id,
        oldHost: input.oldHost.toLowerCase(),
        oldPathRaw: input.oldPathRaw,
        oldPathNormalized,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        decision: input.decision,
        gscClicks16m: input.gscClicks16m ?? null,
        gscImpressions16m: input.gscImpressions16m ?? null,
        backlinks: input.backlinks ?? null,
        notes: input.notes ?? null
      })
      .returning();

    await ctx.recordAudit({
      action: "LEGACY_URL_REGISTERED",
      entityType: "legacy_url",
      entityId: id,
      after: {
        oldHost: input.oldHost.toLowerCase(),
        oldPathNormalized,
        decision: input.decision,
        entityId: input.entityId ?? null
      }
    });

    return created!;
  });
}

export async function listLegacyUrls(db: AppDatabase | DbExecutor) {
  return db.select().from(legacyUrls).orderBy(desc(legacyUrls.gscClicks16m), asc(legacyUrls.oldPathNormalized));
}

export async function getSkuWithDetails(db: AppDatabase | DbExecutor, skuId: string) {
  const [sku] = await db.select().from(skus).where(eq(skus.id, skuId)).limit(1);
  if (!sku) {
    throw new AppError("NOT_FOUND", `SKU ${skuId} not found.`);
  }

  const [category] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, sku.categoryId))
    .limit(1);

  const [productType] = sku.productTypeId
    ? await db
        .select()
        .from(productTypes)
        .where(eq(productTypes.id, sku.productTypeId))
        .limit(1)
    : [undefined];

  const [family] = sku.productFamilyId
    ? await db
        .select()
        .from(productFamilies)
        .where(eq(productFamilies.id, sku.productFamilyId))
        .limit(1)
    : [undefined];

  const identifiers = await listSkuIdentifiers(db, sku.id);
  const mappings = await listAccountingMappingsForSku(db, sku.id);
  const listings = await listStorefrontListingsForSku(db, sku.id);
  const slugHistory = await listSkuSlugHistory(db, sku.id);
  const components = sku.isComposedBundle ? await getBundleComponents(db, sku.id) : [];

  const qrIdentifier =
    identifiers.find((i) => i.identifierType === "INTERNAL_QR")?.value ??
    `khidi://sku/${sku.internalSku}`;

  const labelSpec = buildThermalLabelSpec({
    internalSku: sku.internalSku,
    qrValue: qrIdentifier,
    titleKa: sku.displayNameKa ?? sku.modelCode ?? sku.internalSku,
    brand: sku.brand,
    modelCode: sku.modelCode
  });

  return {
    sku,
    category: category ?? null,
    productType: productType ?? null,
    family: family ?? null,
    identifiers,
    accountingMappings: mappings,
    storefrontListings: listings,
    slugHistory,
    bundleComponents: components,
    labelSpec
  };
}

export async function listSkusWorkspace(db: AppDatabase | DbExecutor) {
  const allSkus = await db.select().from(skus).orderBy(asc(skus.internalSku));
  const allCategories = await db.select().from(categories);
  const allTypes = await db.select().from(productTypes);
  const allMappings = await db
    .select({
      skuId: accountingMappings.skuId,
      legalEntityId: accountingMappings.legalEntityId,
      legalEntityKey: legalEntities.key,
      accountingItemId: accountingMappings.accountingItemId,
      active: accountingMappings.active
    })
    .from(accountingMappings)
    .innerJoin(legalEntities, eq(accountingMappings.legalEntityId, legalEntities.id))
    .where(eq(accountingMappings.active, true));

  const allIdentifiers = await db.select().from(skuIdentifiers);
  const allListings = await db
    .select({
      skuId: storefrontListings.skuId,
      storefrontKey: storefronts.key,
      enabled: storefrontListings.enabled
    })
    .from(storefrontListings)
    .innerJoin(storefronts, eq(storefrontListings.storefrontId, storefronts.id));

  const catMap = new Map(allCategories.map((c) => [c.id, c]));
  const typeMap = new Map(allTypes.map((t) => [t.id, t]));

  return allSkus.map((s) => {
    const cat = catMap.get(s.categoryId);
    const pt = s.productTypeId ? typeMap.get(s.productTypeId) : undefined;
    const skuMappings = allMappings.filter((m) => m.skuId === s.id);
    const skuIds = allIdentifiers.filter((i) => i.skuId === s.id);
    const skuListings = allListings.filter((l) => l.skuId === s.id);

    return {
      ...s,
      categoryNameKa: cat?.nameKa ?? "—",
      categoryKey: cat?.key ?? "UNCLASSIFIED",
      productTypeNameKa: pt?.nameKa ?? "—",
      productTypeKey: pt?.key ?? null,
      activeAccountingMappings: skuMappings,
      identifiersCount: skuIds.length,
      hasIdentifierCollision: skuIds.some((i) => i.hasCollision),
      storefrontListings: skuListings
    };
  });
}

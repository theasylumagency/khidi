import { and, eq, inArray, ne, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  evidence, evidenceAttributions, getAffectedSkuIds, getSkuImages, getSkuLineageIds, imageBelongsToSku,
  productImages, productIntakes, productTypes, resolveActiveSku, scanTasks, skuFieldProvenance, skuSplitBasis, skus, users,
  type DbExecutor, type EvidenceClaimSource, type EvidenceValue, type ProductTypeAttributeFieldDef
} from "@khidi/db";
import { withDomainTransaction, type DomainActor, type DomainTransactionContext } from "@khidi/domain";
import { acquireDomainLocks, IDENTITY_CATALOG_LOCK } from "@khidi/domain/locking";
import { AppError, createUuidV7 } from "@khidi/shared";
import { refreshSkuContentReview } from "./content-review.ts";
import {
  allowsEvidencePdf, computeIdentity, evidenceSensitivity, evidenceStrength, evidenceValuesDiffer, EVIDENCE_TYPES, hasVerifiedDifference,
  IDENTITY_KINDS, isDocumentAnchor, resolveEvidenceField, type IdentityKind, type ResolvedField
} from "./rules.ts";
import { applyMergeUncertainty, type EvidenceSource } from "./merge-uncertainty.ts";

export const UNIVERSAL_EVIDENCE_FIELDS = [
  "power_kw", "engine_displacement_cm3", "length_mm", "width_mm", "height_mm",
  "working_width_mm", "working_depth_mm", "weight_kg", "volume_l", "pressure_bar", "flow_l_min",
  "voltage_v", "current_a"
] as const;
const canonicalUnits: Record<(typeof UNIVERSAL_EVIDENCE_FIELDS)[number], string> = {
  power_kw: "kW", engine_displacement_cm3: "cm³", length_mm: "mm", width_mm: "mm", height_mm: "mm",
  working_width_mm: "mm", working_depth_mm: "mm", weight_kg: "kg", volume_l: "L", pressure_bar: "bar",
  flow_l_min: "L/min", voltage_v: "V", current_a: "A"
};
export interface EvidenceFieldOption { key: string; label: string; dataType: string; unit?: string; values?: string[]; observable?: boolean }
export function evidenceFieldOptions(productType?: Pick<CatalogType, "attributeSchemaJson"> | null): EvidenceFieldOption[] {
  return [
    ...identityTextFields.map((key) => ({ key, label: key, dataType: "string" })),
    ...UNIVERSAL_EVIDENCE_FIELDS.map((key) => ({ key, label: key, dataType: "number", unit: canonicalUnits[key] })),
    ...(productType?.attributeSchemaJson ?? []).filter((field) => !identityTextFields.includes(field.key)
      && !UNIVERSAL_EVIDENCE_FIELDS.some((key) => key === field.key)).map((field) => ({
      key: field.key, label: field.labelKa, dataType: field.dataType, unit: field.unit, values: field.enumValues, observable: field.observable
    }))
  ];
}
const identityTextFields = ["brand", "model_code", "manufacturer", "product_type"];
const defaultObservableFields = new Set(["fuel_type", "wheel_type", "wheel_size", "transmission_gears", "start_type", "pto_shaft", "part_category", "shaft_type"]);
export function withDefaultObservableAttributes(fields: readonly ProductTypeAttributeFieldDef[]) {
  return fields.map((field) => field.observable === undefined && defaultObservableFields.has(field.key) ? { ...field, observable: true } : field);
}
const evidenceCaptureTypes = new Set(["PACKAGING_PHOTO", "PRODUCT_MARKING_PHOTO", "SUPPLIER_DOCUMENT", "MEASUREMENT"]);
const uuid = z.string().uuid();
const valueSchema = z.union([z.string().trim().min(1).max(400), z.number().finite(), z.boolean()]);
const fieldKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const claimsSchema = z.record(fieldKeySchema, valueSchema);
const notesSchema = z.string().trim().min(1).max(4000);
const evidenceInput = z.object({
  skuId: uuid, taskId: uuid.optional(), type: z.enum(EVIDENCE_TYPES), imageId: uuid.optional(),
  capturedAt: z.string().datetime({ offset: true }).optional(), supplierName: z.string().trim().min(1).max(200).optional(),
  documentNumber: z.string().trim().min(1).max(200).optional(), lineText: notesSchema.optional(),
  quantity: z.number().int().min(1).max(2147483647).optional(), notes: notesSchema.optional(),
  measurementUnit: z.string().trim().min(1).max(40).optional(), measurementMethod: notesSchema.optional(),
  comparisonSkuId: uuid.optional(), comparisonImageId: uuid.optional(), comparisonClaims: claimsSchema.optional(),
  comparisonRelation: z.enum(["DIFFERS","MATCHES"]).default("DIFFERS"),
  acknowledgedUnknowns: z.record(fieldKeySchema, notesSchema).default({}),
  intakeId: uuid.optional(),
  supportingEvidenceIds: z.array(uuid).max(30).default([]),
  comparisonSupportingEvidenceIds: z.array(uuid).max(30).default([]),
  claims: claimsSchema.default({}),
  supersedesEvidenceId: uuid.optional(), supersessionReason: notesSchema.optional()
}).strict().refine((input) => !!input.supersedesEvidenceId === !!input.supersessionReason);

type CatalogSku = typeof skus.$inferSelect;
type CatalogType = typeof productTypes.$inferSelect;
type EvidenceRow = typeof evidence.$inferSelect;
export type PrivateEvidenceMedia = { key: string; sha256: string; mimeType: string };

async function activeActor(tx: DbExecutor, actor: DomainActor) {
  const [user] = actor.userId
    ? await tx.select({ id: users.id, role: users.role }).from(users).where(and(eq(users.id, actor.userId), eq(users.active, true)))
    : [];
  if (!user) throw new AppError("FORBIDDEN", "An active staff account is required.");
  return user;
}

async function requireEvidenceAdmin(tx: DbExecutor, actor: DomainActor) {
  const user = await activeActor(tx, actor);
  if (user.role !== "ADMIN") throw new AppError("FORBIDDEN", "Evidence review requires ADMIN.");
  return user.id;
}

// Keep competing READY transitions and writes to their identity inputs in one lock order.
export async function lockIdentityCatalog(tx: DbExecutor) {
  await acquireDomainLocks(tx, { advisoryKeys: [IDENTITY_CATALOG_LOCK] });
}

async function loadSku(tx: DbExecutor, skuId: string) {
  const [sku] = await tx.select().from(skus).where(eq(skus.id, skuId));
  if (!sku) throw new AppError("NOT_FOUND", "SKU not found.");
  return sku;
}

async function loadType(tx: DbExecutor, sku: CatalogSku) {
  return sku.productTypeId ? (await tx.select().from(productTypes).where(eq(productTypes.id, sku.productTypeId)))[0] : undefined;
}

function validateClaims(claims: Record<string, EvidenceValue>, productType: CatalogType | undefined, type: string) {
  for (const [field, value] of Object.entries(claims)) {
    const definition = productType?.attributeSchemaJson.find((candidate) => candidate.key === field);
    const isUniversal = UNIVERSAL_EVIDENCE_FIELDS.some((candidate) => candidate === field);
    const isIdentity = identityTextFields.includes(field);
    if (type === "ADMIN_PHYSICAL_INSPECTION" && (!definition?.observable || isUniversal || isIdentity)) {
      throw new AppError("VALIDATION_ERROR", "Physical inspection may state only observable facts.");
    }
    const valid = definition?.dataType === "enum" ? typeof value === "string" && definition.enumValues?.includes(value)
      : definition ? typeof value === definition.dataType
      : isUniversal ? typeof value === "number" && value > 0
      : isIdentity && typeof value === "string";
    if (!valid) throw new AppError("VALIDATION_ERROR", `Invalid value for evidence field ${field}.`);
  }
}

async function validateComparison(tx: DbExecutor, subject: CatalogSku, type: CatalogType | undefined, input: {
  type: string; comparisonSkuId?: string | null; imageId?: string | null; comparisonImageId?: string | null;
  claims: Record<string, EvidenceValue>; comparisonClaims?: Record<string, EvidenceValue> | null; notes?: string | null;
  comparisonRelation?: string; acknowledgedUnknowns?: Record<string, string>;
  supportingEvidenceIds?: string[]; comparisonSupportingEvidenceIds?: string[];
}) {
  if (!input.comparisonSkuId) {
    if (input.comparisonClaims || input.comparisonImageId) throw new AppError("VALIDATION_ERROR", "Choose a SKU for comparison.");
    return;
  }
  const compared = await loadSku(tx, input.comparisonSkuId);
  const candidate = input.type === "STAFF_STATEMENT" && input.comparisonRelation === "DIFFERS";
  if ((!candidate && input.type !== "ADMIN_PHYSICAL_INSPECTION") || !input.notes || subject.id === compared.id || !type
    || compared.productTypeId !== type.id || [subject, compared].some((sku) => sku.lifecycleState === "ARCHIVED")) {
    throw new AppError("VALIDATION_ERROR", "Compare two live SKUs of the same Product Type.");
  }
  const other = input.comparisonClaims ?? {};
  validateClaims(other, type, input.type);
  if (candidate) {
    const ids = [...(input.supportingEvidenceIds??[]),...(input.comparisonSupportingEvidenceIds??[])];
    const found = ids.length ? await tx.select({id:evidence.id}).from(evidence).where(inArray(evidence.id,ids)) : [];
    if (!input.supportingEvidenceIds?.length || !input.comparisonSupportingEvidenceIds?.length
      || new Set(found.map((row)=>row.id)).size !== new Set(ids).size
      || !Object.entries(other).some(([key,value])=>Object.hasOwn(input.claims,key)&&evidenceValuesDiffer(input.claims[key]!,value))) {
      throw new AppError("VALIDATION_ERROR","Candidate differences require existing supporting evidence on both sides.");
    }
    if (Object.keys({...input.claims,...other}).some((key)=>!type.distinguishingAttributes.includes(key)
      || type.attributeSchemaJson.some((field)=>field.key===key&&field.observable))) {
      throw new AppError("VALIDATION_ERROR","Candidate comparisons are for non-observable distinguishing attributes.");
    }
    return;
  }
  if (input.comparisonRelation === "MATCHES") {
    const observable = (type.distinguishingAttributes ?? []).filter((key) =>
      type.attributeSchemaJson.some((field) => field.key === key && field.observable) && !UNIVERSAL_EVIDENCE_FIELDS.some((field) => field === key));
    const keys = new Set([...observable, ...Object.keys(input.claims), ...Object.keys(other)]);
    if ([...keys].some((key) => !Object.hasOwn(input.claims,key) || !Object.hasOwn(other,key)
      || evidenceValuesDiffer(input.claims[key]!,other[key]!))) {
      throw new AppError("VALIDATION_ERROR", "Record matching observable distinguishing values on both products.");
    }
    for (const key of Object.keys(input.acknowledgedUnknowns ?? {})) {
      if (!type.distinguishingAttributes.includes(key) || observable.includes(key)) {
        throw new AppError("VALIDATION_ERROR", "Only non-observable distinguishing attributes may be acknowledged unknown.");
      }
    }
  } else if (!Object.entries(other).some(([field, value]) => Object.hasOwn(input.claims, field) && evidenceValuesDiffer(input.claims[field]!, value))) {
    throw new AppError("VALIDATION_ERROR", "Record a different observable value for the same field on both SKUs.");
  }
  if (!input.imageId || !input.comparisonImageId) throw new AppError("VALIDATION_ERROR", "Choose a verified photo of each SKU.");
  const photos = await tx.select({ id: productImages.id }).from(productImages)
    .where(and(inArray(productImages.id, [input.imageId, input.comparisonImageId]), eq(productImages.status, "VERIFIED")));
  if (!photos.some((photo) => photo.id === input.imageId) || !photos.some((photo) => photo.id === input.comparisonImageId)
    || !await imageBelongsToSku(tx,input.imageId,subject.id) || !await imageBelongsToSku(tx,input.comparisonImageId,compared.id)) {
    throw new AppError("VALIDATION_ERROR", "Each verified photo must belong to the SKU it shows.");
  }
}

async function findIndistinguishable(tx: DbExecutor, sku: CatalogSku, productType: CatalogType | undefined,
  fields: ReadonlyMap<string, { status: string; value: EvidenceValue | null }>) {
  if (!productType) return [];
  const peers = await tx.select({ id: skus.id, internalSku: skus.internalSku }).from(skus)
    .where(and(eq(skus.productTypeId, productType.id), eq(skus.lifecycleState, "READY"), ne(skus.id, sku.id)));
  if (!peers.length) return [];
  const peerFields = await tx.select().from(skuFieldProvenance).where(inArray(skuFieldProvenance.skuId, peers.map((peer) => peer.id)));
  return peers.filter((peer) => !hasVerifiedDifference(fields, new Map(peerFields.filter((field) => field.skuId === peer.id && !field.notDeterminableReason)
      .map((field) => [field.fieldName, field]))));
}

/** Recheck an immutable inspection against current photos and field verification at merge time. */
export async function requireMergeSameness(tx: DbExecutor, sourceSkuId: string, targetSkuId: string, evidenceId: string,
  sourceFacts: ReadonlyMap<string, {status:string;value:EvidenceValue|null}>,
  targetFacts: ReadonlyMap<string, {status:string;value:EvidenceValue|null}>) {
  const [item] = await tx.select().from(evidence).where(eq(evidence.id,evidenceId));
  if (!item || item.status !== "ACCEPTED" || item.type !== "ADMIN_PHYSICAL_INSPECTION"
    || item.comparisonRelation !== "MATCHES"
    || !((item.skuId === sourceSkuId && item.comparisonSkuId === targetSkuId)
      || (item.skuId === targetSkuId && item.comparisonSkuId === sourceSkuId))) {
    throw new AppError("PRECONDITION_FAILED","Merge requires an accepted sameness inspection of these two SKUs.");
  }
  const subject = await loadSku(tx,item.skuId);
  const [type] = subject.productTypeId ? await tx.select().from(productTypes).where(eq(productTypes.id,subject.productTypeId)) : [];
  await validateComparison(tx,subject,type,item);
  const acknowledgements = [];
  for (const key of type!.distinguishingAttributes) {
    const left=sourceFacts.get(key),right=targetFacts.get(key);
    if (left?.status==="CONFLICT" || right?.status==="CONFLICT") {
      throw new AppError("CONFLICT","Resolve conflicting distinguishing facts before merging.");
    }
    if (type!.attributeSchemaJson.some((field)=>field.key===key && field.observable)
      && !UNIVERSAL_EVIDENCE_FIELDS.some((field)=>field===key)) continue;
    const sourceUnknown=left?.status!=="VERIFIED",targetUnknown=right?.status!=="VERIFIED";
    if (!sourceUnknown && !targetUnknown) {
      if (evidenceValuesDiffer(left!.value!,right!.value!)) throw new AppError("CONFLICT","Verified distinguishing values differ.");
      continue;
    }
    const reason=item.acknowledgedUnknowns[key]?.trim();
    if (!reason) throw new AppError("PRECONDITION_FAILED","Explicitly acknowledge each undetermined distinguishing field.",{field:key});
    acknowledgements.push({fieldName:key,reason,sourceUnknown,targetUnknown,
      expectedValue:!sourceUnknown?left!.value:!targetUnknown?right!.value:null});
  }
  return {item,acknowledgements};
}

export async function loadSkuEvidenceSources(tx: DbExecutor, ids: string[]) {
  const lineage = new Set(ids);
  const attributed = await tx.select().from(evidenceAttributions).where(inArray(evidenceAttributions.targetSkuId,ids));
  const items = await tx.select().from(evidence).where(or(inArray(evidence.skuId, ids), inArray(evidence.comparisonSkuId, ids),
    attributed.length ? inArray(evidence.id,attributed.map((row) => row.evidenceId)) : undefined));
  const photoIds = items.flatMap((item) => item.comparisonClaims && item.imageId && item.comparisonImageId
    ? [item.imageId, item.comparisonImageId] : []);
  const photos = photoIds.length ? await tx.select({ id: productImages.id, skuId: productImages.skuId }).from(productImages)
    .where(and(inArray(productImages.id, photoIds), eq(productImages.status, "VERIFIED"))) : [];
  const validPhotos = new Set(photos.map((photo) => photo.id));
  const results: EvidenceSource[] = [];
  for (const item of items) {
    const own = lineage.has(item.skuId);
    const sides = attributed.filter((row) => row.evidenceId === item.id).map((row) => row.claimSkuId);
    if (own) sides.push(item.skuId);
    if (item.comparisonSkuId && lineage.has(item.comparisonSkuId)) sides.push(item.comparisonSkuId);
    if (item.comparisonClaims) {
      if (item.type === "ADMIN_PHYSICAL_INSPECTION" && (!item.imageId || !item.comparisonImageId || !validPhotos.has(item.imageId)
        || !validPhotos.has(item.comparisonImageId) || !await imageBelongsToSku(tx,item.imageId,item.skuId)
        || !await imageBelongsToSku(tx,item.comparisonImageId,item.comparisonSkuId!))) continue;
      if (own && item.comparisonSkuId && lineage.has(item.comparisonSkuId) && item.comparisonRelation === "DIFFERS") continue;
    }
    for (const side of new Set(sides)) {
      if (side === item.skuId) results.push({...item,claimSkuId:side});
      else if (side === item.comparisonSkuId && item.comparisonClaims) results.push({ ...item, claims: item.comparisonClaims,
        claimSources: item.comparisonClaimSources ?? {}, imageId: item.comparisonImageId,claimSkuId:side });
    }
  }
  return results;
}

async function projectSkuIdentity(ctx: DomainTransactionContext, skuId: string) {
  const [sku, lineage] = await Promise.all([loadSku(ctx.tx, skuId), getSkuLineageIds(ctx.tx, skuId)]);
  const [productType, items, priorFields, photos] = await Promise.all([
    loadType(ctx.tx, sku),
    loadSkuEvidenceSources(ctx.tx, lineage),
    ctx.tx.select().from(skuFieldProvenance).where(eq(skuFieldProvenance.skuId, skuId)),
    getSkuImages(ctx.tx,skuId).then((images) => images.filter((image) => image.status === "VERIFIED"))
  ]);
  const decisions = new Map(priorFields.map((field) => [field.fieldName, field]));
  const distinguishingAttributes = productType?.distinguishingAttributes ?? [];
  const allowedFields = new Set(evidenceFieldOptions(productType).map((field) => field.key));
  const fieldNames = new Set([...identityTextFields, ...distinguishingAttributes, ...decisions.keys(),
    ...items.flatMap((item) => Object.keys(item.claims))]);
  const fields = new Map<string, ResolvedField>();
  for (const fieldName of fieldNames) {
    const decision = decisions.get(fieldName);
    let field = resolveEvidenceField(fieldName, allowedFields.has(fieldName) ? items : [], decision);
    if (fieldName === "product_type" && productType && field.value !== null && field.value !== productType.key) {
      field = { ...field, status: "CONFLICT", value: null, strong: false };
    }
    const nowVerified = !!decision?.notDeterminableReason && field.status === "VERIFIED";
    if (nowVerified) {
      decisions.delete(fieldName);
      await ctx.recordAudit({ action: "EVIDENCE_FIELD_DETERMINED", entityType: "sku", entityId: skuId,
        before: { field: fieldName, reason: decision.notDeterminableReason }, after: { field: fieldName, evidenceIds: field.evidenceIds } });
    } else if (decision?.notDeterminableReason && field.status !== "CONFLICT") {
      field = { ...field, status: "NOT_FOUND", value: null, strong: false };
    }
    fields.set(fieldName, field);
    const projection = { value: field.value, status: field.status, evidenceIds: field.evidenceIds };
    await ctx.tx.insert(skuFieldProvenance).values({ skuId, fieldName, ...projection })
      .onConflictDoUpdate({ target: [skuFieldProvenance.skuId, skuFieldProvenance.fieldName], set: nowVerified
        ? { ...projection, notDeterminableReason: null, decidedBy: null, decidedAt: null } : projection });
  }
  const merged = await applyMergeUncertainty(ctx,skuId,lineage,items,fields,decisions);
  for (const [fieldName,field] of fields) await ctx.tx.update(skuFieldProvenance).set({
    value:field.value,status:field.status,evidenceIds:field.evidenceIds
  }).where(and(eq(skuFieldProvenance.skuId,skuId),eq(skuFieldProvenance.fieldName,fieldName)));
  const basis = await ctx.tx.select().from(skuSplitBasis).where(inArray(skuSplitBasis.targetSkuId,lineage));
  const basisUnverified = basis.length > 0 && !basis.some((item)=>fields.get(item.fieldName)?.status==="VERIFIED"
    && !evidenceValuesDiffer(fields.get(item.fieldName)!.value!,item.value));
  if (sku.splitBasisUnverified !== basisUnverified) {
    await ctx.tx.update(skus).set({splitBasisUnverified:basisUnverified}).where(eq(skus.id,skuId));
    await ctx.recordAudit({action:"SPLIT_BASIS_VERIFICATION_CHANGED",entityType:"sku",entityId:skuId,
      before:{unverified:sku.splitBasisUnverified},after:{unverified:basisUnverified}});
  }
  return { sku, productType, items, photos, decisions, distinguishingAttributes, fields, mergeConflict:merged.conflict,
    previousFields: new Map(priorFields.map((field) => [field.fieldName, field])) };
}

async function saveSkuIdentity(ctx: DomainTransactionContext, projection: Awaited<ReturnType<typeof projectSkuIdentity>>) {
  const { sku, productType, items, photos, decisions, distinguishingAttributes, fields, previousFields } = projection;
  const skuId = sku.id;
  const duplicates = await findIndistinguishable(ctx.tx, sku, productType, fields);
  let result = computeIdentity({
    kind: sku.identityKind as IdentityKind, productTypeSet: !!productType?.active,
    referencePhotos: ["MAIN", "SECONDARY"].every((slot) => photos.some((photo) => photo.slot === slot)),
    unique: duplicates.length === 0, fields, decisions, distinguishingAttributes, items
  });
  if (projection.mergeConflict) result = {...result,level:"CONFLICT"};
  const reverificationRequired = sku.lifecycleState === "READY" && (result.level === "LOW" || result.level === "CONFLICT");
  await ctx.tx.update(skus).set({
    identityConfidence: result.level, identityRuleVersion: result.ruleVersion,
    identityEvidenceIds: result.evidenceIds, reverificationRequired, updatedAt: new Date()
  }).where(eq(skus.id, skuId));
  if (sku.identityConfidence !== result.level || sku.reverificationRequired !== reverificationRequired) {
    await ctx.recordAudit({ action: "SKU_IDENTITY_RECOMPUTED", entityType: "sku", entityId: skuId,
      before: { confidence: sku.identityConfidence, reverificationRequired: sku.reverificationRequired },
      after: { ...result, reverificationRequired } });
    const attention = reverificationRequired || projection.mergeConflict;
    await ctx.emitOutboxEvent({ eventType: attention ? "PRODUCT_REVIEW_REQUIRED" : "PRODUCT_UPDATED",
      aggregateType: "sku", aggregateId: skuId, payload: { skuId, confidence: result.level, reverificationRequired,
        ...(attention ? { severity: "ACTION_REQUIRED", reason: projection.mergeConflict ? "MERGE_EVIDENCE_CONFLICT" : "IDENTITY_REVERIFICATION" } : {}) },
      consumers: attention ? ["notifications"] : [] });
  }
  await refreshSkuContentReview(ctx, skuId, previousFields);
  return { ...result, fields, decisions, productType, duplicates, reverificationRequired };
}

async function recomputeSkuIdentities(ctx: DomainTransactionContext, ids: (string | null | undefined)[]) {
  await lockIdentityCatalog(ctx.tx);
  const expanded = [...ids];
  for (const id of ids) if (id) expanded.push(...await getAffectedSkuIds(ctx.tx,id));
  const roots = new Set<string>();
  for (const id of expanded) if (id) roots.add((await resolveActiveSku(ctx.tx, id))?.id ?? id);
  await acquireDomainLocks(ctx.tx, { skuIds: [...roots] });
  const projections = [];
  for (const id of [...roots].sort()) projections.push(await projectSkuIdentity(ctx, id));
  // Write both sets of fields before evaluating whether either SKU has a verified difference.
  const results = [];
  for (const projection of projections) results.push(await saveSkuIdentity(ctx, projection));
  return results;
}

export async function recomputeSkuIdentity(ctx: DomainTransactionContext, skuId: string) {
  return (await recomputeSkuIdentities(ctx, [skuId]))[0]!;
}

export async function recomputeIdentityAfterPhotoDecision(ctx: DomainTransactionContext, skuId: string, imageId: string) {
  await lockIdentityCatalog(ctx.tx);
  const comparisons = await ctx.tx.select({ skuId: evidence.skuId, comparisonSkuId: evidence.comparisonSkuId })
    .from(evidence).where(and(ne(evidence.status, "REJECTED"), or(eq(evidence.imageId, imageId), eq(evidence.comparisonImageId, imageId))));
  await recomputeSkuIdentities(ctx, [skuId, ...comparisons.flatMap((item) => [item.skuId, item.comparisonSkuId])]);
}

function evidenceReading(item: EvidenceRow) {
  return { id: item.id, status: item.status, claims: item.claims, claimSources: item.claimSources,
    comparisonSkuId: item.comparisonSkuId, comparisonRelation: item.comparisonRelation, acknowledgedUnknowns: item.acknowledgedUnknowns,
    comparisonClaims: item.comparisonClaims, comparisonClaimSources: item.comparisonClaimSources,
    intakeId:item.intakeId,imageId:item.imageId,comparisonImageId:item.comparisonImageId,
    supportingEvidenceIds:item.supportingEvidenceIds,comparisonSupportingEvidenceIds:item.comparisonSupportingEvidenceIds };
}

function humanClaimSources(claims: Record<string, EvidenceValue>, userId: string) {
  return Object.fromEntries(Object.keys(claims).map((field) => [field, { origin: "HUMAN" as const, userId }]));
}

async function evidenceChanged(ctx: DomainTransactionContext, item: EvidenceRow, action: string, reason?: string, previous?: EvidenceRow) {
  await ctx.recordAudit({ action, entityType: "evidence", entityId: item.id,
    before: previous ? evidenceReading(previous) : undefined,
    after: { skuId: item.skuId, type: item.type, sensitivity: item.sensitivity,
      ...evidenceReading(item) }, reason });
  await ctx.emitOutboxEvent({ eventType: "EVIDENCE_UPDATED", aggregateType: "evidence", aggregateId: item.id,
    payload: { skuId: item.skuId, evidenceId: item.id, status: item.status,
      ...(item.comparisonSkuId ? { comparisonSkuId: item.comparisonSkuId } : {}) },
    consumers: action === "EVIDENCE_SUBMITTED" && item.imageId && item.sensitivity === "AI_ALLOWED" ? ["ai-discovery"] : [] });
}

async function rejectEvidence(ctx: DomainTransactionContext, item: EvidenceRow, adminId: string, reason: string) {
  const [rejected] = await ctx.tx.update(evidence).set({ status: "REJECTED", decidedBy: adminId, decidedAt: new Date(), decisionReason: reason })
    .where(eq(evidence.id, item.id)).returning();
  const revoked = await ctx.tx.update(skuFieldProvenance).set({ confirmedEvidenceId: null, decidedBy: null, decidedAt: null })
    .where(eq(skuFieldProvenance.confirmedEvidenceId, item.id))
    .returning({ skuId: skuFieldProvenance.skuId, fieldName: skuFieldProvenance.fieldName });
  for (const { skuId, fieldName } of revoked) {
    await ctx.recordAudit({ action: "EVIDENCE_FIELD_CONFIRMATION_REVOKED", entityType: "sku", entityId: skuId,
      before: { field: fieldName, evidenceId: item.id }, reason });
  }
  await evidenceChanged(ctx, rejected!, "EVIDENCE_REJECTED", reason, item);
  return rejected!;
}

export async function applyAiEvidenceCandidates(ctx: DomainTransactionContext, evidenceId: string, jobId: string, raw: Record<string, EvidenceValue>) {
  await lockIdentityCatalog(ctx.tx);
  const [item] = await ctx.tx.select().from(evidence).where(eq(evidence.id, evidenceId));
  if (!item || item.status !== "PENDING" || item.sensitivity !== "AI_ALLOWED" || item.type === "MEASUREMENT") return;
  const sku = await loadSku(ctx.tx, item.skuId), type = await loadType(ctx.tx, sku);
  const parsed = claimsSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid provider candidates.");
  const candidates = Object.entries(parsed.data).filter(([field]) => !Object.hasOwn(item.claims, field));
  if (!candidates.length) return;
  validateClaims(Object.fromEntries(candidates), type, item.type);
  const claimSources = { ...item.claimSources };
  for (const [field] of candidates) claimSources[field] = { origin: "AI", jobId };
  const [updated] = await ctx.tx.update(evidence).set({ claims: { ...item.claims, ...Object.fromEntries(candidates) }, claimSources })
    .where(eq(evidence.id, item.id)).returning();
  await evidenceChanged(ctx, updated!, "AI_EVIDENCE_CANDIDATES_RECORDED");
  await recomputeSkuIdentity(ctx, item.skuId);
}

export async function submitSkuEvidence(
  db: DbExecutor, actor: DomainActor, raw: unknown, attachment?: PrivateEvidenceMedia
) {
  const parsed = evidenceInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid evidence submission.");
  const { supersessionReason, ...input } = parsed.data;
  if (attachment?.mimeType === "application/pdf" && (!allowsEvidencePdf(input.type) || input.imageId)) {
    throw new AppError("VALIDATION_ERROR", "PDF evidence must be a private document without a linked photo.");
  }
  return withDomainTransaction(db, actor, async (ctx) => {
    await lockIdentityCatalog(ctx.tx);
    const author = await activeActor(ctx.tx, actor);
    const sku = await loadSku(ctx.tx, input.skuId);
    if (sku.lifecycleState === "ARCHIVED") throw new AppError("PRECONDITION_FAILED", "Archived SKU cannot receive evidence.");
    const productType = await loadType(ctx.tx, sku);
    if(input.intakeId) {
      const [intake]=await ctx.tx.select().from(productIntakes).where(eq(productIntakes.id,input.intakeId));
      if(!intake?.matchedSkuId || (await resolveActiveSku(ctx.tx,intake.matchedSkuId))?.id!==sku.id) {
        throw new AppError("VALIDATION_ERROR","Evidence intake must resolve to this SKU.");
      }
    }
    let task;
    if (input.taskId) {
      [task] = await ctx.tx.select().from(scanTasks).where(eq(scanTasks.id, input.taskId)).for("update");
      const assigned = task && (task.assigneeUserId ? task.assigneeUserId === author.id : task.assigneeRole === author.role);
      if (!task || task.taskType !== "EVIDENCE_REQUEST" || task.targetSkuId !== sku.id
        || !["OPEN", "IN_PROGRESS"].includes(task.status) || (!assigned && author.role !== "ADMIN")) {
        throw new AppError("FORBIDDEN", "An assigned open evidence task is required.");
      }
      if (!evidenceCaptureTypes.has(input.type)) throw new AppError("VALIDATION_ERROR", "Evidence type unavailable for capture.");
    }
    if (author.role !== "ADMIN" && (!task || author.role !== "WAREHOUSE"
      || input.documentNumber || input.lineText || input.quantity || input.supplierName || input.supersedesEvidenceId)) {
      throw new AppError("FORBIDDEN", "Evidence registry and document line entry require ADMIN.");
    }
    const [superseded] = input.supersedesEvidenceId ? await ctx.tx.select().from(evidence)
      .where(and(eq(evidence.id, input.supersedesEvidenceId), eq(evidence.skuId, sku.id), eq(evidence.status, "ACCEPTED"))) : [];
    if (input.supersedesEvidenceId && !superseded) {
      throw new AppError("PRECONDITION_FAILED", "A replacement requires accepted evidence for the same SKU.");
    }
    if (input.imageId) {
      const [image] = await ctx.tx.select({ id: productImages.id }).from(productImages)
        .where(and(eq(productImages.id, input.imageId), ne(productImages.status, "REJECTED")));
      if (!image || !await imageBelongsToSku(ctx.tx,input.imageId,sku.id)) throw new AppError("VALIDATION_ERROR", "Evidence image must belong to this SKU.");
    }
    if (input.type === "ADMIN_PHYSICAL_INSPECTION" && (!input.notes && !input.imageId)) {
      throw new AppError("VALIDATION_ERROR", "Physical inspection requires a photo or a note.");
    }
    const measurementField = evidenceFieldOptions(productType).find((field) => field.key === Object.keys(input.claims)[0]);
    if (input.type === "MEASUREMENT" && (!input.measurementMethod || !input.measurementUnit
      || measurementField?.unit !== input.measurementUnit || Object.values(input.claims).length !== 1
      || typeof Object.values(input.claims)[0] !== "number")) {
      throw new AppError("VALIDATION_ERROR", "Measurement requires one numeric value, a unit and a method.");
    }
    validateClaims(input.claims, productType, input.type);
    await validateComparison(ctx.tx, sku, productType, input);
    const [item] = await ctx.tx.insert(evidence).values({
      ...input, id: createUuidV7(), authorId: author.id, authorRole: author.role,
      claimSources: humanClaimSources(input.claims, author.id),
      comparisonClaimSources: input.comparisonClaims ? humanClaimSources(input.comparisonClaims, author.id) : null,
      capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date(),
      sensitivity: evidenceSensitivity(input.type, !!input.imageId, !!attachment),
      privateStorageKey: attachment?.key, privateSha256: attachment?.sha256, privateMimeType: attachment?.mimeType
    }).returning();
    if (superseded && supersessionReason) {
      const rejected = await rejectEvidence(ctx, superseded, author.id, supersessionReason);
      await ctx.recordAudit({ action: "EVIDENCE_SUPERSEDED", entityType: "evidence", entityId: item!.id,
        before: evidenceReading(superseded), after: { ...evidenceReading(item!), supersedesEvidenceId: rejected.id,
          supersededStatus: rejected.status }, reason: supersessionReason });
    }
    if (task) {
      const completedCount = task.completedCount + 1;
      const done = completedCount >= (task.targetCount ?? 1);
      await ctx.tx.update(scanTasks).set({ completedCount, status: done ? "COMPLETED" : "IN_PROGRESS",
        completedAt: done ? new Date() : null }).where(eq(scanTasks.id, task.id));
      if (done) {
        await ctx.recordAudit({ action: "SCAN_TASK_COMPLETED", entityType: "scan_task", entityId: task.id, after: { completedCount } });
        await ctx.emitOutboxEvent({ eventType: "SCAN_TASK_COMPLETED", aggregateType: "scan_task", aggregateId: task.id, payload: { completedCount }, consumers: ["notifications"] });
      }
    }
    await evidenceChanged(ctx, item!, "EVIDENCE_SUBMITTED");
    await recomputeSkuIdentities(ctx, [sku.id, item!.comparisonSkuId, superseded?.comparisonSkuId]);
    return item!;
  });
}

export async function reviewSkuEvidence(db: DbExecutor, actor: DomainActor, raw: unknown) {
  const parsed = z.object({ evidenceId: uuid, status: z.enum(["ACCEPTED", "REJECTED"]), reason: notesSchema,
    claims: claimsSchema.optional(), comparisonClaims: claimsSchema.optional(), confirmedAiFields: z.array(z.string()).optional(),
    documentNumber: z.string().trim().min(1).max(200).optional(),
    lineText: notesSchema.optional(), quantity: z.number().int().min(1).max(2147483647).optional() }).strict().safeParse(raw);
  if (!parsed.success || (parsed.data.status === "ACCEPTED" && !parsed.data.claims)) {
    throw new AppError("VALIDATION_ERROR", "Review requires a reason and explicitly confirmed readings on acceptance.");
  }
  const input = parsed.data;
  return withDomainTransaction(db, actor, async (ctx) => {
    await lockIdentityCatalog(ctx.tx);
    const adminId = await requireEvidenceAdmin(ctx.tx, actor);
    const [item] = await ctx.tx.select().from(evidence).where(eq(evidence.id, input.evidenceId));
    if (!item) throw new AppError("NOT_FOUND", "Evidence not found.");
    if (item.status === "REJECTED" || (item.status === "ACCEPTED" && input.status === "ACCEPTED")) {
      throw new AppError("PRECONDITION_FAILED", "Evidence decision is final. Submit a replacement to correct accepted evidence.");
    }
    if (input.status === "REJECTED") {
      const rejected = await rejectEvidence(ctx, item, adminId, input.reason);
      await recomputeSkuIdentities(ctx, [item.skuId, item.comparisonSkuId]);
      return rejected;
    }
    const sku = await loadSku(ctx.tx, item.skuId);
    const productType = await loadType(ctx.tx, sku);
    const claims = { ...input.claims! };
    const claimSources: Record<string, EvidenceClaimSource> = {};
    const confirmedAiFields = new Set(input.confirmedAiFields);
    const confirmed: { field: string; jobId: string; value: EvidenceValue }[] = [];
    for (const field of confirmedAiFields) {
      const source = item.claimSources[field];
      if (source?.origin !== "AI" || !Object.hasOwn(claims, field) || claims[field] !== item.claims[field]) {
        throw new AppError("VALIDATION_ERROR", "Confirm the exact AI reading shown for each selected field.");
      }
      confirmed.push({ field, jobId: source.jobId, value: claims[field]! });
    }
    for (const [field, value] of Object.entries(claims)) {
      const source = item.claimSources[field];
      if (source?.origin === "AI") {
        if (!confirmedAiFields.has(field)) {
          delete claims[field];
          continue;
        }
        claimSources[field] = { ...source, confirmedBy: adminId };
      } else {
        claimSources[field] = source && value === item.claims[field] ? source : { origin: "HUMAN", userId: adminId };
      }
    }
    validateClaims(claims, productType, item.type);
    const comparisonClaims = input.comparisonClaims ?? item.comparisonClaims;
    await validateComparison(ctx.tx, sku, productType, { ...item, claims, comparisonClaims });
    const comparisonClaimSources = comparisonClaims && Object.fromEntries(Object.entries(comparisonClaims).map(([field, value]) => {
      const previousSource = item.comparisonClaimSources?.[field];
      const source: EvidenceClaimSource = previousSource && value === item.comparisonClaims?.[field]
        ? previousSource : { origin: "HUMAN", userId: adminId };
      return [field, source];
    }));
    const [fieldName] = Object.keys(claims);
    if (item.type === "MEASUREMENT" && (Object.keys(claims).length !== 1 || !fieldName || !Object.hasOwn(item.claims, fieldName)
      || typeof claims[fieldName] !== "number" || !item.measurementUnit
      || evidenceFieldOptions(productType).find((field) => field.key === fieldName)?.unit !== item.measurementUnit)) {
      throw new AppError("VALIDATION_ERROR", "Confirm the measured value in its recorded field and unit.");
    }
    if (confirmed.length) {
      await ctx.recordAudit({ action: "EVIDENCE_AI_CLAIMS_CONFIRMED", entityType: "evidence", entityId: item.id,
        after: { confirmed }, reason: input.reason });
    }
    const documentNumber = input.documentNumber ?? item.documentNumber, lineText = input.lineText ?? item.lineText;
    if (item.type === "SUPPLIER_DOCUMENT" && (!documentNumber || !lineText)) {
      throw new AppError("VALIDATION_ERROR", "Accepting a supplier document requires its number and the relevant line extract.");
    }
    const [updated] = await ctx.tx.update(evidence).set({ claims, claimSources, comparisonClaims, comparisonClaimSources,
      status: input.status, decidedBy: adminId, decidedAt: new Date(),
      decisionReason: input.reason, documentNumber, lineText, quantity: input.quantity ?? item.quantity }).where(eq(evidence.id, item.id)).returning();
    await evidenceChanged(ctx, updated!, "EVIDENCE_ACCEPTED", input.reason, item);
    await recomputeSkuIdentities(ctx, [item.skuId, item.comparisonSkuId]);
    return updated!;
  });
}

export async function decideSkuEvidenceField(db: DbExecutor, actor: DomainActor, raw: unknown) {
  const parsed = z.object({ skuId: uuid, field: z.string(), evidenceId: uuid.optional(), reason: notesSchema }).strict().safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "A field and reason are required.");
  const input = parsed.data;
  return withDomainTransaction(db, actor, async (ctx) => {
    await lockIdentityCatalog(ctx.tx);
    const adminId = await requireEvidenceAdmin(ctx.tx, actor);
    const sku = await loadSku(ctx.tx, input.skuId);
    const productType = await loadType(ctx.tx, sku);
    if (input.evidenceId) {
      const item = (await loadSkuEvidenceSources(ctx.tx,await getSkuLineageIds(ctx.tx,sku.id)))
        .find((candidate)=>candidate.id===input.evidenceId && Object.hasOwn(candidate.claims,input.field));
      if (!item || item.status !== "ACCEPTED" || evidenceStrength(item) !== "MEDIUM" || !Object.hasOwn(item.claims, input.field)) {
        throw new AppError("VALIDATION_ERROR", "Choose accepted Medium evidence for this field.");
      }
    } else {
      const [field] = await ctx.tx.select({ status: skuFieldProvenance.status }).from(skuFieldProvenance)
        .where(and(eq(skuFieldProvenance.skuId, sku.id), eq(skuFieldProvenance.fieldName, input.field)));
      if (!productType?.distinguishingAttributes.includes(input.field) || field?.status === "VERIFIED") {
        throw new AppError("VALIDATION_ERROR", "Only an unverified distinguishing attribute can be marked not determinable.");
      }
    }
    const decision = { confirmedEvidenceId: input.evidenceId ?? null, notDeterminableReason: input.evidenceId ? null : input.reason,
      decidedBy: adminId, decidedAt: new Date() };
    await ctx.tx.insert(skuFieldProvenance).values({ skuId: sku.id, fieldName: input.field, status: "NOT_FOUND", ...decision })
      .onConflictDoUpdate({ target: [skuFieldProvenance.skuId, skuFieldProvenance.fieldName], set: decision });
    await ctx.recordAudit({ action: input.evidenceId ? "EVIDENCE_FIELD_CONFIRMED" : "EVIDENCE_FIELD_NOT_DETERMINABLE", entityType: "sku",
      entityId: sku.id, after: { field: input.field, evidenceId: input.evidenceId ?? null }, reason: input.reason });
    await ctx.emitOutboxEvent({ eventType: "EVIDENCE_UPDATED", aggregateType: "sku", aggregateId: sku.id, payload: { field: input.field }, consumers: [] });
    return recomputeSkuIdentity(ctx, sku.id);
  });
}

export async function setSkuIdentityKind(db: DbExecutor, actor: DomainActor, skuId: string, kind: IdentityKind, reason: string) {
  if (!IDENTITY_KINDS.includes(kind) || !notesSchema.safeParse(reason).success) throw new AppError("VALIDATION_ERROR", "Identity kind and reason required.");
  return withDomainTransaction(db, actor, async (ctx) => {
    await lockIdentityCatalog(ctx.tx);
    await requireEvidenceAdmin(ctx.tx, actor);
    const sku = await loadSku(ctx.tx, skuId);
    if (["READY", "ARCHIVED"].includes(sku.lifecycleState) && sku.identityKind !== kind) {
      throw new AppError("PRECONDITION_FAILED", "Move the SKU into review before changing its identity kind.");
    }
    const before = await recomputeSkuIdentity(ctx, skuId);
    if (kind === "MANUFACTURER_IDENTIFIED" && !["brand", "model_code"].every((field) => before.fields.get(field)?.status === "VERIFIED")) {
      throw new AppError("PRECONDITION_FAILED", "Manufacturer identity requires verified brand and model.");
    }
    await ctx.tx.update(skus).set({ identityKind: kind }).where(eq(skus.id, skuId));
    await ctx.recordAudit({ action: "SKU_IDENTITY_KIND_CHANGED", entityType: "sku", entityId: skuId,
      before: { kind: sku.identityKind }, after: { kind }, reason });
    await ctx.emitOutboxEvent({ eventType: "EVIDENCE_UPDATED", aggregateType: "sku", aggregateId: skuId, payload: { kind }, consumers: [] });
    return recomputeSkuIdentity(ctx, skuId);
  });
}

export async function listSkuEvidence(db: DbExecutor, actor: DomainActor, skuId: string) {
  await requireEvidenceAdmin(db, actor);
  const sku = await loadSku(db, skuId);
  const lineage = await getSkuLineageIds(db, skuId);
  const attributedIds=db.select({id:evidenceAttributions.evidenceId}).from(evidenceAttributions)
    .where(inArray(evidenceAttributions.targetSkuId,lineage));
  const [items, fields, productType] = await Promise.all([
    db.select().from(evidence).where(or(inArray(evidence.skuId, lineage),inArray(evidence.id,attributedIds))),
    db.select().from(skuFieldProvenance).where(eq(skuFieldProvenance.skuId, skuId)),
    loadType(db, sku)
  ]);
  const resolved = new Map(fields.map((field) => [field.fieldName, field]));
  const comparisons = await findIndistinguishable(db, sku, productType, resolved);
  const comparisonSkus=productType?await db.select({id:skus.id,internalSku:skus.internalSku}).from(skus)
    .where(and(eq(skus.productTypeId,productType.id),ne(skus.id,skuId),ne(skus.lifecycleState,"ARCHIVED"))):[];
  const comparisonPhotos=(await Promise.all(comparisonSkus.map(async(peer)=>
    (await getSkuImages(db,peer.id)).filter((photo)=>photo.status==="VERIFIED").map((photo)=>({
      skuId:peer.id,internalSku:peer.internalSku,imageId:photo.id,slot:photo.slot,sortOrder:photo.sortOrder
    }))))).flat();
  const incomingComparisons = await db.select({ id: evidence.id, skuId: evidence.skuId }).from(evidence)
    .where(and(inArray(evidence.comparisonSkuId, lineage), notInArray(evidence.skuId, lineage)));
  for(const item of items)if(!lineage.includes(item.skuId)&&!incomingComparisons.some((row)=>row.id===item.id))
    incomingComparisons.push({id:item.id,skuId:item.skuId});
  return { sku, items, fields, productType, comparisons, comparisonPhotos, incomingComparisons };
}

export async function registerObservableAttribute(db: DbExecutor, actor: DomainActor, raw: unknown) {
  const parsed = z.object({ productTypeId: uuid, key: fieldKeySchema, labelKa: z.string().trim().min(1).max(120),
    labelEn: z.string().trim().min(1).max(120), dataType: z.enum(["string", "boolean", "number"]).default("string"), reason: notesSchema })
    .strict().safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "A field key, labels, and reason are required.");
  const { productTypeId, key, labelKa, labelEn, dataType, reason } = parsed.data;
  if (identityTextFields.includes(key) || UNIVERSAL_EVIDENCE_FIELDS.some((field) => field === key)) {
    throw new AppError("VALIDATION_ERROR", "Physical inspection cannot replace identity or measurement evidence.");
  }
  return withDomainTransaction(db, actor, async (ctx) => {
    await lockIdentityCatalog(ctx.tx);
    await requireEvidenceAdmin(ctx.tx, actor);
    const [type] = await ctx.tx.select().from(productTypes).where(and(eq(productTypes.id, productTypeId), eq(productTypes.active, true)));
    if (!type) throw new AppError("NOT_FOUND", "Active Product Type not found.");
    const previous = type.attributeSchemaJson.find((field) => field.key === key);
    if (previous?.observable) throw new AppError("CONFLICT", "This field is already observable.");
    const field: ProductTypeAttributeFieldDef = previous ? { ...previous, observable: true }
      : { key, labelKa, labelEn, dataType, observable: true, tier: "OPTIONAL_SPEC", filterCandidate: false };
    const attributes = previous ? type.attributeSchemaJson.map((entry) => entry.key === key ? field : entry)
      : [...type.attributeSchemaJson, field];
    await ctx.tx.update(productTypes).set({ attributeSchemaJson: attributes, updatedAt: new Date() }).where(eq(productTypes.id, type.id));
    await ctx.recordAudit({ action: "PRODUCT_TYPE_OBSERVABLE_ATTRIBUTE_REGISTERED", entityType: "product_type", entityId: type.id,
      before: { field: previous ?? null }, after: { field }, reason });
    await ctx.emitOutboxEvent({ eventType: "PRODUCT_UPDATED", aggregateType: "product_type", aggregateId: type.id,
      payload: { observableAttribute: key }, consumers: [] });
  });
}

export async function classifySkuProductType(db: DbExecutor, actor: DomainActor, skuId: string, productTypeId: string, reason: string) {
  if (!uuid.safeParse(productTypeId).success || !notesSchema.safeParse(reason).success) throw new AppError("VALIDATION_ERROR", "Product Type and reason required.");
  return withDomainTransaction(db, actor, async (ctx) => {
    await lockIdentityCatalog(ctx.tx);
    await requireEvidenceAdmin(ctx.tx, actor);
    const sku = await loadSku(ctx.tx, skuId);
    if (sku.lifecycleState === "READY" || sku.lifecycleState === "ARCHIVED") {
      throw new AppError("PRECONDITION_FAILED", "Move the SKU into review before changing its Product Type.");
    }
    const [type] = await ctx.tx.select().from(productTypes).where(and(eq(productTypes.id, productTypeId), eq(productTypes.active, true)));
    if (!type) throw new AppError("NOT_FOUND", "Active Product Type not found.");
    await ctx.tx.update(skus).set({ productTypeId: type.id, categoryId: type.defaultCategoryId }).where(eq(skus.id, skuId));
    await ctx.recordAudit({ action: "SKU_PRODUCT_TYPE_CHANGED", entityType: "sku", entityId: skuId,
      before: { productTypeId: sku.productTypeId }, after: { productTypeId }, reason });
    await ctx.emitOutboxEvent({ eventType: "EVIDENCE_UPDATED", aggregateType: "sku", aggregateId: skuId, payload: { productTypeId }, consumers: [] });
    return recomputeSkuIdentity(ctx, skuId);
  });
}

export async function listMissingEvidence(db: DbExecutor, actor: DomainActor, supplier?: string) {
  await requireEvidenceAdmin(db, actor);
  const candidates = await db.select({ id: skus.id, internalSku: skus.internalSku, name: skus.displayNameKa,
    reverificationRequired: skus.reverificationRequired, confidence: skus.identityConfidence,
    distinguishing: productTypes.distinguishingAttributes }).from(skus)
    .leftJoin(productTypes, eq(productTypes.id, skus.productTypeId)).where(ne(skus.lifecycleState, "ARCHIVED"));
  const [items, fields] = await Promise.all([db.select({
    skuId: evidence.skuId, supplierName: evidence.supplierName, type: evidence.type, status: evidence.status
  }).from(evidence), db.select().from(skuFieldProvenance)]);
  return candidates.flatMap(({ distinguishing, ...sku }) => {
    const skuItems = items.filter((item) => item.skuId === sku.id);
    const supplierNames = [...new Set(skuItems.map((item) => item.supplierName).filter((name): name is string => !!name))];
    if (supplier && !supplierNames.some((name) => name.toLowerCase().includes(supplier.toLowerCase()))) return [];
    const missingFields = (distinguishing ?? []).filter((field) =>
      !fields.some((item) => item.skuId === sku.id && item.fieldName === field && item.status === "VERIFIED"));
    const missingAnchor = !skuItems.some(isDocumentAnchor);
    return sku.reverificationRequired || missingAnchor || missingFields.length ? [{ ...sku, supplierNames, missingFields, missingAnchor }] : [];
  });
}

/** Public facts come from evidence projections, never from draft/legacy input columns. */
export async function getStorefrontIdentityFacts(db: DbExecutor, skuId: string) {
  const sku = await loadSku(db, skuId);
  const fields = await db.select().from(skuFieldProvenance).where(and(
    eq(skuFieldProvenance.skuId, skuId), eq(skuFieldProvenance.status, "VERIFIED")
  ));
  return {
    identityConflict: sku.identityConfidence === "CONFLICT",
    fields: Object.fromEntries(fields.filter((field) => !field.notDeterminableReason).map((field) => [field.fieldName, field.value]))
  };
}

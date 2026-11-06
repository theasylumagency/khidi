import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  evidence, productImages, productTypes, scanTasks, skuFieldProvenance, skus, users,
  type DbExecutor, type EvidenceValue
} from "@khidi/db";
import { withDomainTransaction, type DomainActor, type DomainTransactionContext } from "@khidi/domain";
import { AppError, createUuidV7 } from "@khidi/shared";
import {
  computeIdentity, evidenceSensitivity, evidenceStrength, EVIDENCE_TYPES, hasVerifiedDifference,
  IDENTITY_KINDS, isDocumentAnchor, resolveEvidenceField, type IdentityKind, type ResolvedField
} from "./rules.ts";

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
export interface EvidenceFieldOption { key: string; label: string; dataType: string; unit?: string; values?: string[] }
export function evidenceFieldOptions(productType?: Pick<CatalogType, "attributeSchemaJson"> | null): EvidenceFieldOption[] {
  return [
    ...identityTextFields.map((key) => ({ key, label: key, dataType: "string" })),
    ...UNIVERSAL_EVIDENCE_FIELDS.map((key) => ({ key, label: key, dataType: "number", unit: canonicalUnits[key] })),
    ...(productType?.attributeSchemaJson ?? []).filter((field) => !identityTextFields.includes(field.key)
      && !UNIVERSAL_EVIDENCE_FIELDS.some((key) => key === field.key)).map((field) => ({
      key: field.key, label: field.labelKa, dataType: field.dataType, unit: field.unit, values: field.enumValues
    }))
  ];
}
const identityTextFields = ["brand", "model_code", "manufacturer", "product_type"];
const observableFields = new Set(["fuel_type", "wheel_type", "wheel_size", "transmission_gears", "start_type", "pto_shaft", "part_category", "shaft_type"]);
const evidenceCaptureTypes = new Set(["PACKAGING_PHOTO", "PRODUCT_MARKING_PHOTO", "SUPPLIER_DOCUMENT", "MEASUREMENT"]);
const uuid = z.string().uuid();
const valueSchema = z.union([z.string().trim().min(1).max(400), z.number().finite(), z.boolean()]);
const claimsSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), valueSchema);
const notesSchema = z.string().trim().min(1).max(4000);
const evidenceInput = z.object({
  skuId: uuid, taskId: uuid.optional(), type: z.enum(EVIDENCE_TYPES), imageId: uuid.optional(),
  capturedAt: z.string().datetime({ offset: true }).optional(), supplierName: z.string().trim().min(1).max(200).optional(),
  documentNumber: z.string().trim().min(1).max(200).optional(), lineText: notesSchema.optional(),
  quantity: z.number().int().min(1).max(2147483647).optional(), notes: notesSchema.optional(),
  measurementUnit: z.string().trim().min(1).max(40).optional(), measurementMethod: notesSchema.optional(),
  comparisonSkuId: uuid.optional(), claims: claimsSchema.default({})
}).strict();

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
  await tx.execute(sql`SELECT pg_advisory_xact_lock(412629, 5)`);
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
    if (type === "ADMIN_PHYSICAL_INSPECTION" && !observableFields.has(field)) {
      throw new AppError("VALIDATION_ERROR", "Physical inspection may state only observable facts.");
    }
    const valid = definition?.dataType === "enum" ? typeof value === "string" && definition.enumValues?.includes(value)
      : definition ? typeof value === definition.dataType
      : isUniversal ? typeof value === "number" && value > 0
      : isIdentity && typeof value === "string";
    if (!valid) throw new AppError("VALIDATION_ERROR", `Invalid value for evidence field ${field}.`);
  }
}

async function findIndistinguishable(tx: DbExecutor, sku: CatalogSku, productType: CatalogType | undefined,
  fields: ReadonlyMap<string, { status: string; value: EvidenceValue | null }>) {
  if (!productType) return [];
  const peers = await tx.select({ id: skus.id, internalSku: skus.internalSku }).from(skus)
    .where(and(eq(skus.productTypeId, productType.id), eq(skus.lifecycleState, "READY"), ne(skus.id, sku.id)));
  if (!peers.length) return [];
  const peerFields = await tx.select().from(skuFieldProvenance).where(inArray(skuFieldProvenance.skuId, peers.map((peer) => peer.id)));
  const comparisons = await tx.select({ skuId: evidence.skuId, comparedSkuId: evidence.comparisonSkuId }).from(evidence)
    .where(and(eq(evidence.type, "ADMIN_PHYSICAL_INSPECTION"), eq(evidence.status, "ACCEPTED"),
      or(eq(evidence.skuId, sku.id), eq(evidence.comparisonSkuId, sku.id))));
  return peers.filter((peer) => !comparisons.some((item) =>
    (item.skuId === sku.id && item.comparedSkuId === peer.id) || (item.skuId === peer.id && item.comparedSkuId === sku.id))
    && !hasVerifiedDifference(fields, new Map(peerFields.filter((field) => field.skuId === peer.id && !field.notDeterminableReason)
      .map((field) => [field.fieldName, field]))));
}

export async function recomputeSkuIdentity(ctx: DomainTransactionContext, skuId: string) {
  await lockIdentityCatalog(ctx.tx);
  const sku = await loadSku(ctx.tx, skuId);
  const [productType, items, priorFields, photos] = await Promise.all([
    loadType(ctx.tx, sku),
    ctx.tx.select().from(evidence).where(eq(evidence.skuId, skuId)),
    ctx.tx.select().from(skuFieldProvenance).where(eq(skuFieldProvenance.skuId, skuId)),
    ctx.tx.select({ slot: productImages.slot }).from(productImages)
      .where(and(eq(productImages.skuId, skuId), eq(productImages.status, "VERIFIED"), inArray(productImages.slot, ["MAIN", "SECONDARY"])))
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
  const duplicates = await findIndistinguishable(ctx.tx, sku, productType, fields);
  const result = computeIdentity({
    kind: sku.identityKind as IdentityKind, productTypeSet: !!productType?.active,
    referencePhotos: ["MAIN", "SECONDARY"].every((slot) => photos.some((photo) => photo.slot === slot)),
    unique: duplicates.length === 0, fields, decisions, distinguishingAttributes, items
  });
  const reverificationRequired = sku.lifecycleState === "READY" && (result.level === "LOW" || result.level === "CONFLICT");
  await ctx.tx.update(skus).set({
    identityConfidence: result.level, identityRuleVersion: result.ruleVersion,
    identityEvidenceIds: result.evidenceIds, reverificationRequired, updatedAt: new Date()
  }).where(eq(skus.id, skuId));
  if (sku.identityConfidence !== result.level || sku.reverificationRequired !== reverificationRequired) {
    await ctx.recordAudit({ action: "SKU_IDENTITY_RECOMPUTED", entityType: "sku", entityId: skuId,
      before: { confidence: sku.identityConfidence, reverificationRequired: sku.reverificationRequired },
      after: { ...result, reverificationRequired } });
    await ctx.emitOutboxEvent({ eventType: reverificationRequired ? "PRODUCT_REVIEW_REQUIRED" : "PRODUCT_UPDATED",
      aggregateType: "sku", aggregateId: skuId, payload: { skuId, confidence: result.level, reverificationRequired,
        ...(reverificationRequired ? { severity: "ACTION_REQUIRED", reason: "IDENTITY_REVERIFICATION" } : {}) },
      consumers: reverificationRequired ? ["notifications"] : [] });
  }
  return { ...result, fields, decisions, productType, duplicates, reverificationRequired };
}

async function evidenceChanged(ctx: DomainTransactionContext, item: EvidenceRow, action: string, reason?: string) {
  await ctx.recordAudit({ action, entityType: "evidence", entityId: item.id,
    after: { skuId: item.skuId, type: item.type, sensitivity: item.sensitivity, status: item.status }, reason });
  await ctx.emitOutboxEvent({ eventType: "EVIDENCE_UPDATED", aggregateType: "evidence", aggregateId: item.id,
    payload: { skuId: item.skuId, evidenceId: item.id, status: item.status },
    consumers: action === "EVIDENCE_SUBMITTED" && item.imageId && item.sensitivity === "AI_ALLOWED" ? ["ai-discovery"] : [] });
}

export async function applyAiEvidenceCandidates(ctx: DomainTransactionContext, evidenceId: string, raw: Record<string, EvidenceValue>) {
  await lockIdentityCatalog(ctx.tx);
  const [item] = await ctx.tx.select().from(evidence).where(eq(evidence.id, evidenceId));
  if (!item || item.status !== "PENDING" || item.sensitivity !== "AI_ALLOWED") return;
  const sku = await loadSku(ctx.tx, item.skuId), type = await loadType(ctx.tx, sku);
  const parsed = claimsSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid provider candidates.");
  validateClaims(parsed.data, type, item.type);
  const [updated] = await ctx.tx.update(evidence).set({ claims: { ...parsed.data, ...item.claims } })
    .where(eq(evidence.id, item.id)).returning();
  await evidenceChanged(ctx, updated!, "AI_EVIDENCE_CANDIDATES_RECORDED");
  await recomputeSkuIdentity(ctx, item.skuId);
}

export async function submitSkuEvidence(
  db: DbExecutor, actor: DomainActor, raw: unknown, attachment?: PrivateEvidenceMedia
) {
  const parsed = evidenceInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid evidence submission.");
  const input = parsed.data;
  return withDomainTransaction(db, actor, async (ctx) => {
    await lockIdentityCatalog(ctx.tx);
    const author = await activeActor(ctx.tx, actor);
    const sku = await loadSku(ctx.tx, input.skuId);
    if (sku.lifecycleState === "ARCHIVED") throw new AppError("PRECONDITION_FAILED", "Archived SKU cannot receive evidence.");
    const productType = await loadType(ctx.tx, sku);
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
      || input.documentNumber || input.lineText || input.quantity || input.supplierName)) {
      throw new AppError("FORBIDDEN", "Evidence registry and document line entry require ADMIN.");
    }
    if (input.imageId) {
      const [image] = await ctx.tx.select({ id: productImages.id }).from(productImages)
        .where(and(eq(productImages.id, input.imageId), eq(productImages.skuId, sku.id), ne(productImages.status, "REJECTED")));
      if (!image) throw new AppError("VALIDATION_ERROR", "Evidence image must belong to this SKU.");
    }
    if (input.type === "ADMIN_PHYSICAL_INSPECTION" && (!input.notes && !input.imageId)) {
      throw new AppError("VALIDATION_ERROR", "Physical inspection requires a photo or a note.");
    }
    if (input.comparisonSkuId) {
      const compared = await loadSku(ctx.tx, input.comparisonSkuId);
      if (input.type !== "ADMIN_PHYSICAL_INSPECTION" || !input.notes || sku.id === compared.id
        || !sku.productTypeId || compared.productTypeId !== sku.productTypeId || compared.lifecycleState === "ARCHIVED") {
        throw new AppError("VALIDATION_ERROR", "Record an observable difference against a live SKU of the same Product Type.");
      }
    }
    const measurementField = evidenceFieldOptions(productType).find((field) => field.key === Object.keys(input.claims)[0]);
    if (input.type === "MEASUREMENT" && (!input.measurementMethod || !input.measurementUnit
      || measurementField?.unit !== input.measurementUnit || Object.values(input.claims).length !== 1
      || typeof Object.values(input.claims)[0] !== "number")) {
      throw new AppError("VALIDATION_ERROR", "Measurement requires one numeric value, a unit and a method.");
    }
    validateClaims(input.claims, productType, input.type);
    const [item] = await ctx.tx.insert(evidence).values({
      ...input, id: createUuidV7(), authorId: author.id, authorRole: author.role,
      capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date(),
      sensitivity: evidenceSensitivity(input.type, !!input.imageId, !!attachment),
      privateStorageKey: attachment?.key, privateSha256: attachment?.sha256, privateMimeType: attachment?.mimeType
    }).returning();
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
    await recomputeSkuIdentity(ctx, sku.id);
    return item!;
  });
}

export async function reviewSkuEvidence(db: DbExecutor, actor: DomainActor, raw: unknown) {
  const parsed = z.object({ evidenceId: uuid, status: z.enum(["ACCEPTED", "REJECTED"]), reason: notesSchema,
    claims: claimsSchema.optional(), documentNumber: z.string().trim().min(1).max(200).optional(),
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
    const sku = await loadSku(ctx.tx, item.skuId);
    const productType = await loadType(ctx.tx, sku);
    const claims = input.status === "ACCEPTED" ? input.claims! : item.claims;
    if (input.status === "ACCEPTED") {
      validateClaims(claims, productType, item.type);
      const [fieldName] = Object.keys(claims);
      if (item.type === "MEASUREMENT" && (Object.keys(claims).length !== 1 || !fieldName || !Object.hasOwn(item.claims, fieldName)
        || typeof claims[fieldName] !== "number" || !item.measurementUnit
        || evidenceFieldOptions(productType).find((field) => field.key === fieldName)?.unit !== item.measurementUnit)) {
        throw new AppError("VALIDATION_ERROR", "Confirm the measured value in its recorded field and unit.");
      }
    }
    const documentNumber = input.documentNumber ?? item.documentNumber, lineText = input.lineText ?? item.lineText;
    if (input.status === "ACCEPTED" && item.type === "SUPPLIER_DOCUMENT" && (!documentNumber || !lineText)) {
      throw new AppError("VALIDATION_ERROR", "Accepting a supplier document requires its number and the relevant line extract.");
    }
    const confirmations = await ctx.tx.select({ fieldName: skuFieldProvenance.fieldName }).from(skuFieldProvenance)
      .where(eq(skuFieldProvenance.confirmedEvidenceId, item.id));
    for (const { fieldName } of confirmations) {
      if (input.status !== "REJECTED" && claims[fieldName] === item.claims[fieldName]) continue;
      await ctx.tx.update(skuFieldProvenance).set({ confirmedEvidenceId: null, decidedBy: null, decidedAt: null })
        .where(and(eq(skuFieldProvenance.skuId, sku.id), eq(skuFieldProvenance.fieldName, fieldName)));
      await ctx.recordAudit({ action: "EVIDENCE_FIELD_CONFIRMATION_REVOKED", entityType: "sku", entityId: sku.id,
        before: { field: fieldName, evidenceId: item.id }, reason: input.reason });
    }
    const [updated] = await ctx.tx.update(evidence).set({ claims, status: input.status, decidedBy: adminId, decidedAt: new Date(),
      decisionReason: input.reason, documentNumber, lineText, quantity: input.quantity ?? item.quantity }).where(eq(evidence.id, item.id)).returning();
    await evidenceChanged(ctx, updated!, input.status === "ACCEPTED" ? "EVIDENCE_ACCEPTED" : "EVIDENCE_REJECTED", input.reason);
    await recomputeSkuIdentity(ctx, item.skuId);
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
      const [item] = await ctx.tx.select().from(evidence).where(and(eq(evidence.id, input.evidenceId), eq(evidence.skuId, sku.id)));
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
  const [items, fields, productType] = await Promise.all([
    db.select().from(evidence).where(eq(evidence.skuId, skuId)),
    db.select().from(skuFieldProvenance).where(eq(skuFieldProvenance.skuId, skuId)),
    loadType(db, sku)
  ]);
  const resolved = new Map(fields.map((field) => [field.fieldName, field]));
  const comparisons = await findIndistinguishable(db, sku, productType, resolved);
  return { sku, items, fields, productType, comparisons };
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
